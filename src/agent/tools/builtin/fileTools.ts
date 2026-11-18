import picomatch from "picomatch";
import { isLikelyBinary, normalizeVirtualPath } from "../../sandbox/paths";
import type { Sandbox } from "../../sandbox";
import { defineTool } from "../types";

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_CHARS = 2000;
const MAX_SEARCH_RESULTS = 500;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache", ".home"]);

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** 递归列出文件（虚拟路径），跳过常见大目录 */
export const walkFiles = async (sandbox: Sandbox, root: string, limit = 5000): Promise<string[]> => {
  const out: string[] = [];
  const queue = [normalizeVirtualPath(root)];
  while (queue.length && out.length < limit) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await sandbox.fs.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.type === "directory") {
        if (!IGNORED_DIRS.has(entry.name)) queue.push(entry.path);
      } else {
        out.push(entry.path);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
};

export const ReadTool = defineTool<{ file_path: string; offset?: number; limit?: number; char_offset?: number; char_limit?: number }>({
  name: "Read",
  toolset: "file",
  readOnly: true,
  description:
    "Read a file from the workspace. Paths are virtual absolute paths rooted at the workspace (e.g. /src/App.tsx). " +
    "Returns content with line numbers (cat -n format). Use offset/limit for large files, or char_offset/char_limit for long single-line logs (zero-based character offset).",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Virtual absolute path of the file" },
      char_offset: { type: "integer", minimum: 0 },
      char_limit: { type: "integer", minimum: 1, maximum: 12000 },
      offset: { type: "number", description: "1-based line number to start reading from" },
      limit: { type: "number", description: "Max number of lines to read (default 2000)" },
    },
    required: ["file_path"],
  },
  async handler(input, { sandbox }) {
    const filePath = normalizeVirtualPath(str(input.file_path));
    const stat = await sandbox.fs.stat(filePath);
    if (!stat) return { content: `File does not exist: ${filePath}`, isError: true };
    if (stat.type === "directory") {
      const entries = await sandbox.fs.readdir(filePath);
      return { content: entries.map((e) => `${e.type === "directory" ? "d" : "-"} ${e.path}`).join("\n") || "(empty directory)" };
    }
    const buffer = await sandbox.fs.readFile(filePath);
    if (isLikelyBinary(buffer)) {
      return { content: `${filePath} is a binary file (${buffer.length} bytes); it cannot be displayed as text.` };
    }
    const text = buffer.toString("utf8");
    if (input.char_offset !== undefined) {
      const start = Math.max(0, Math.floor(input.char_offset));
      const count = Math.min(12000, Math.max(1, input.char_limit || 6000));
      return { content: `Characters ${start}-${Math.min(text.length, start + count)} of ${text.length}:\n${text.slice(start, start + count)}` };
    }
    const lines = text.split("\n");
    const start = Math.max(1, Math.floor(Number(input.offset) || 1));
    const limit = Math.max(1, Math.floor(Number(input.limit) || DEFAULT_READ_LIMIT));
    const slice = lines.slice(start - 1, start - 1 + limit);
    if (slice.length === 0) return { content: `(file has ${lines.length} lines; offset ${start} is past the end)` };
    const body = slice
      .map((line, i) => {
        const clipped = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
        return `${String(start + i).padStart(6, " ")}\t${clipped}`;
      })
      .join("\n");
    const more = start - 1 + slice.length < lines.length ? `\n... (${lines.length} lines total)` : "";
    return { content: body + more };
  },
});

export const WriteTool = defineTool<{ file_path: string; content: string }>({
  name: "Write",
  toolset: "file",
  description: "Create or overwrite a file in the workspace with the given content. Parent directories are created automatically.",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Virtual absolute path of the file" },
      content: { type: "string", description: "Full file content" },
    },
    required: ["file_path", "content"],
  },
  async handler(input, { sandbox }) {
    const filePath = normalizeVirtualPath(str(input.file_path));
    const existed = await sandbox.fs.exists(filePath);
    await sandbox.fs.writeFile(filePath, str(input.content));
    return {
      content: `${existed ? "Updated" : "Created"} ${filePath} (${str(input.content).split("\n").length} lines)`,
      changedPaths: [filePath],
    };
  },
});

export const EditTool = defineTool<{ file_path: string; old_string: string; new_string: string; replace_all?: boolean }>({
  name: "Edit",
  toolset: "file",
  description:
    "Replace an exact string in a file. old_string must match exactly (including whitespace) and be unique unless replace_all is true. " +
    "Use an empty old_string to create a new file.",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      old_string: { type: "string", description: "Exact text to replace" },
      new_string: { type: "string", description: "Replacement text" },
      replace_all: { type: "boolean", description: "Replace every occurrence" },
    },
    required: ["file_path", "old_string", "new_string"],
  },
  async handler(input, { sandbox }) {
    const filePath = normalizeVirtualPath(str(input.file_path));
    const oldString = str(input.old_string);
    const newString = str(input.new_string);
    const exists = await sandbox.fs.exists(filePath);
    if (!exists) {
      if (oldString) return { content: `File does not exist: ${filePath}`, isError: true };
      await sandbox.fs.writeFile(filePath, newString);
      return { content: `Created ${filePath}`, changedPaths: [filePath] };
    }
    const original = await sandbox.fs.readText(filePath);
    if (!oldString) return { content: "old_string must not be empty when editing an existing file", isError: true };
    if (oldString === newString) return { content: "old_string and new_string are identical", isError: true };
    const occurrences = original.split(oldString).length - 1;
    if (occurrences === 0) return { content: `old_string not found in ${filePath}`, isError: true };
    if (occurrences > 1 && !input.replace_all) {
      return {
        content: `old_string occurs ${occurrences} times in ${filePath}; provide more context or set replace_all=true`,
        isError: true,
      };
    }
    const updated = input.replace_all ? original.split(oldString).join(newString) : original.replace(oldString, () => newString);
    await sandbox.fs.writeFile(filePath, updated);
    return { content: `Edited ${filePath} (${input.replace_all ? occurrences : 1} replacement(s))`, changedPaths: [filePath] };
  },
});

export const GlobTool = defineTool<{ pattern: string; path?: string }>({
  name: "Glob",
  toolset: "file",
  readOnly: true,
  description: 'Find files by glob pattern (e.g. "**/*.tsx", "src/**/index.ts"). Returns matching virtual paths.',
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", description: "Directory to search in (default /)" },
    },
    required: ["pattern"],
  },
  async handler(input, { sandbox }) {
    const base = normalizeVirtualPath(str(input.path) || "/");
    const isMatch = picomatch(str(input.pattern), { dot: false });
    const files = await walkFiles(sandbox, base);
    const matched = files.filter((file) => {
      const rel = base === "/" ? file.slice(1) : file.slice(base.length + 1);
      return isMatch(rel) || isMatch(file.slice(1));
    });
    if (matched.length === 0) return { content: "No files found" };
    const shown = matched.slice(0, MAX_SEARCH_RESULTS);
    return {
      content: shown.join("\n") + (matched.length > shown.length ? `\n... (${matched.length - shown.length} more)` : ""),
    };
  },
});

export const GrepTool = defineTool<{
  pattern: string;
  path?: string;
  glob?: string;
  output_mode?: "content" | "files_with_matches" | "count";
  case_insensitive?: boolean;
}>({
  name: "Grep",
  toolset: "file",
  readOnly: true,
  description:
    "Search file contents with a JavaScript regular expression. output_mode: files_with_matches (default), content (matching lines with line numbers), count.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", description: "Directory or file to search (default /)" },
      glob: { type: "string", description: 'Filter files by glob, e.g. "*.ts"' },
      output_mode: { type: "string", enum: ["content", "files_with_matches", "count"] },
      case_insensitive: { type: "boolean" },
    },
    required: ["pattern"],
  },
  async handler(input, { sandbox }) {
    let regex: RegExp;
    try {
      regex = new RegExp(str(input.pattern), input.case_insensitive ? "i" : "");
    } catch (error) {
      return { content: `Invalid regex: ${(error as Error).message}`, isError: true };
    }
    const base = normalizeVirtualPath(str(input.path) || "/");
    const baseStat = await sandbox.fs.stat(base);
    const candidates = baseStat?.type === "file" ? [base] : await walkFiles(sandbox, base);
    const globMatch = input.glob ? picomatch(str(input.glob), { matchBase: true }) : null;
    const mode = input.output_mode || "files_with_matches";
    const out: string[] = [];
    for (const file of candidates) {
      if (globMatch && !globMatch(file.slice(1))) continue;
      let buffer: Buffer;
      try {
        buffer = await sandbox.fs.readFile(file);
      } catch {
        continue;
      }
      if (buffer.length > 2 * 1024 * 1024 || isLikelyBinary(buffer)) continue;
      const lines = buffer.toString("utf8").split("\n");
      let count = 0;
      for (let i = 0; i < lines.length; i += 1) {
        if (!regex.test(lines[i])) continue;
        count += 1;
        if (mode === "content") out.push(`${file}:${i + 1}:${lines[i].slice(0, 500)}`);
        if (mode === "files_with_matches") break;
      }
      if (count > 0 && mode === "files_with_matches") out.push(file);
      if (count > 0 && mode === "count") out.push(`${file}:${count}`);
      if (out.length >= MAX_SEARCH_RESULTS) break;
    }
    return { content: out.length ? out.join("\n") : "No matches found" };
  },
});
