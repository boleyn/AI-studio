import { z } from "zod";

export const globInputSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
});

export const readInputSchema = z.object({
  file_path: z.string().min(1),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  pages: z.string().optional(),
});

export const writeInputSchema = z.object({
  file_path: z.string().min(1),
  content: z.string(),
});

export const editInputSchema = z.object({
  file_path: z.string().min(1),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

export const grepOutputModes = ["content", "files_with_matches", "count"] as const;
export const grepInputSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  glob: z.string().optional(),
  output_mode: z.enum(grepOutputModes).optional(),
  "-B": z.number().optional(),
  "-A": z.number().optional(),
  "-C": z.number().optional(),
  context: z.number().optional(),
  "-n": z.boolean().optional(),
  "-i": z.boolean().optional(),
  type: z.string().optional(),
  head_limit: z.number().optional(),
  offset: z.number().optional(),
  multiline: z.boolean().optional(),
});

export type GlobInput = z.infer<typeof globInputSchema>;
export type ReadInput = z.infer<typeof readInputSchema>;
export type WriteInput = z.infer<typeof writeInputSchema>;
export type EditInput = z.infer<typeof editInputSchema>;
export type GrepInput = z.infer<typeof grepInputSchema>;

export type StructuredPatchHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const globToRegExp = (glob: string) => {
  let out = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    const next = glob[i + 1];
    if (ch === "*" && next === "*") {
      out += ".*";
      i += 1;
      continue;
    }
    if (ch === "*") {
      out += "[^/]*";
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += escapeRegExp(ch);
  }
  out += "$";
  return new RegExp(out);
};

const normalizeToolPath = (value?: string) => {
  const raw = (value || "").trim();
  if (!raw) return "";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  if (withSlash.includes("\\") || withSlash.includes("\0") || withSlash.includes("..")) {
    throw new Error("Invalid file path");
  }
  return withSlash.replace(/\/{2,}/g, "/");
};

const normalizeSearchBasePath = (value?: string) => {
  const normalized = normalizeToolPath(value);
  if (!normalized) return "";
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
};

const applyHeadLimit = <T>(items: T[], limit: number | undefined, offset = 0) => {
  if (limit === 0) {
    return { items: items.slice(offset), appliedLimit: undefined as number | undefined };
  }
  const effectiveLimit = limit ?? 250;
  const sliced = items.slice(offset, offset + effectiveLimit);
  const wasTruncated = items.length - offset > effectiveLimit;
  return {
    items: sliced,
    appliedLimit: wasTruncated ? effectiveLimit : undefined,
  };
};

const filterByPathAndGlob = (paths: string[], input: { path?: string; glob?: string; type?: string }) => {
  const base = normalizeSearchBasePath(input.path);
  const globMatcher = input.glob ? globToRegExp(input.glob) : null;
  const typeSuffix = (input.type || "").trim().toLowerCase();
  return paths.filter((filePath) => {
    if (base) {
      if (!(filePath === base.slice(0, -1) || filePath.startsWith(base))) return false;
    }
    if (globMatcher && !globMatcher.test(filePath)) return false;
    if (typeSuffix) {
      if (!filePath.toLowerCase().endsWith(`.${typeSuffix}`)) return false;
    }
    return true;
  });
};

const countOccurrences = (text: string, matcher: RegExp) => {
  const cloned = new RegExp(matcher.source, matcher.flags.includes("g") ? matcher.flags : `${matcher.flags}g`);
  let total = 0;
  while (cloned.exec(text)) {
    total += 1;
    if (cloned.lastIndex === 0) break;
  }
  return total;
};

const toLineRanges = (text: string, lineNumbers: boolean, before: number, after: number, matcher: RegExp) => {
  const lines = text.split(/\r?\n/);
  const emitted = new Set<number>();
  const output: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    matcher.lastIndex = 0;
    if (!matcher.test(lines[i] || "")) continue;

    const start = Math.max(0, i - before);
    const end = Math.min(lines.length - 1, i + after);
    for (let ln = start; ln <= end; ln += 1) {
      if (emitted.has(ln)) continue;
      emitted.add(ln);
      const prefix = lineNumbers ? `${ln + 1}:` : "";
      output.push(`${prefix}${lines[ln] || ""}`);
    }
  }

  return output;
};

export const selectTextByLines = (content: string, offset?: number, limit?: number) => {
  const lines = content.split(/\r?\n/);
  const start = offset ?? 0;
  const end = limit ? start + limit : undefined;
  const selected = lines.slice(start, end);
  return {
    content: selected.join("\n"),
    numLines: selected.length,
    startLine: start + 1,
    totalLines: lines.length,
  };
};

export const buildStructuredPatch = (originalFile: string | null, content: string): StructuredPatchHunk[] => {
  const oldText = originalFile ?? "";
  const oldLines = oldText.split(/\r?\n/);
  const newLines = content.split(/\r?\n/);

  if (oldText === content) {
    return [
      {
        oldStart: 1,
        oldLines: oldLines.length,
        newStart: 1,
        newLines: newLines.length,
        lines: [],
      },
    ];
  }

  const maxPatchLines = 400;
  const lines = [
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ];

  return [
    {
      oldStart: 1,
      oldLines: oldLines.length,
      newStart: 1,
      newLines: newLines.length,
      lines: lines.length > maxPatchLines ? [...lines.slice(0, maxPatchLines), "...patch truncated"] : lines,
    },
  ];
};

export const normalizeClaudeFilePath = (input: { file_path?: string; path?: string }) => {
  const raw = (input.file_path || input.path || "").trim();
  if (!raw) throw new Error("Missing file_path");
  return normalizeToolPath(raw);
};

export const runClaudeGlob = (filePaths: string[], input: GlobInput) => {
  const startedAt = Date.now();
  const matcher = globToRegExp(input.pattern);
  const base = normalizeSearchBasePath(input.path);

  const filtered = filePaths.filter((filePath) => {
    if (base && !(filePath === base.slice(0, -1) || filePath.startsWith(base))) return false;
    return matcher.test(filePath);
  });

  const limit = 100;
  const filenames = filtered.slice(0, limit);
  return {
    durationMs: Date.now() - startedAt,
    numFiles: filenames.length,
    filenames,
    truncated: filtered.length > limit,
  };
};

export const runClaudeGrep = (files: Record<string, string>, input: GrepInput) => {
  const mode = input.output_mode || "files_with_matches";
  const searchPaths = filterByPathAndGlob(Object.keys(files).sort((a, b) => a.localeCompare(b)), input);
  const lineNumbers = input["-n"] !== false;
  const caseInsensitive = input["-i"] === true;
  const before = Math.max(0, Math.floor(input["-B"] ?? input["-C"] ?? input.context ?? 0));
  const after = Math.max(0, Math.floor(input["-A"] ?? input["-C"] ?? input.context ?? 0));
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const headLimit = input.head_limit === undefined ? undefined : Math.floor(input.head_limit);

  let matcher: RegExp;
  try {
    const flags = `g${caseInsensitive ? "i" : ""}${input.multiline ? "ms" : "m"}`;
    matcher = new RegExp(input.pattern, flags);
  } catch {
    throw new Error("Invalid grep regular expression");
  }

  if (mode === "content") {
    const lines: string[] = [];
    const matchedFiles: string[] = [];
    for (const filePath of searchPaths) {
      const text = files[filePath] || "";
      if (!text) continue;
      const lineOutput = toLineRanges(text, lineNumbers, before, after, matcher);
      if (lineOutput.length === 0) continue;
      matchedFiles.push(filePath);
      for (const line of lineOutput) {
        lines.push(`${filePath}:${line}`);
      }
    }

    const limited = applyHeadLimit(lines, headLimit, offset);
    return {
      mode,
      numFiles: matchedFiles.length,
      filenames: matchedFiles,
      content: limited.items.join("\n"),
      numLines: limited.items.length,
      appliedLimit: limited.appliedLimit,
      appliedOffset: offset || undefined,
    };
  }

  if (mode === "count") {
    const countLines: string[] = [];
    const filenames: string[] = [];
    let numMatches = 0;
    for (const filePath of searchPaths) {
      const text = files[filePath] || "";
      if (!text) continue;
      const count = countOccurrences(text, matcher);
      if (count <= 0) continue;
      filenames.push(filePath);
      numMatches += count;
      countLines.push(`${count}:${filePath}`);
    }

    const limited = applyHeadLimit(countLines, headLimit, offset);
    return {
      mode,
      numFiles: filenames.length,
      filenames,
      content: limited.items.join("\n"),
      numMatches,
      appliedLimit: limited.appliedLimit,
      appliedOffset: offset || undefined,
    };
  }

  const matched = searchPaths.filter((filePath) => {
    const text = files[filePath] || "";
    if (!text) return false;
    matcher.lastIndex = 0;
    return matcher.test(text);
  });
  const limited = applyHeadLimit(matched, headLimit, offset);
  return {
    mode,
    numFiles: limited.items.length,
    filenames: limited.items,
    appliedLimit: limited.appliedLimit,
    appliedOffset: offset || undefined,
  };
};

export const claudeCompatSchemas = {
  Glob: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "The glob pattern to match files against" },
      path: { type: "string", description: "The directory path to search in (optional)" },
    },
    required: ["pattern"],
  },
  Read: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "The absolute path to the file to read" },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1 },
      pages: { type: "string", description: "PDF page range (optional)" },
    },
    required: ["file_path"],
  },
  Write: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "The absolute path to the file to write" },
      content: { type: "string", description: "The content to write" },
    },
    required: ["file_path", "content"],
  },
  Edit: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "The absolute path to the file to modify" },
      old_string: { type: "string", description: "The text to replace" },
      new_string: { type: "string", description: "The replacement text" },
      replace_all: { type: "boolean", description: "Replace all occurrences (default false)" },
    },
    required: ["file_path", "old_string", "new_string"],
  },
  Grep: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
      glob: { type: "string" },
      output_mode: { type: "string", enum: [...grepOutputModes] },
      "-B": { type: "number" },
      "-A": { type: "number" },
      "-C": { type: "number" },
      context: { type: "number" },
      "-n": { type: "boolean" },
      "-i": { type: "boolean" },
      type: { type: "string" },
      head_limit: { type: "number" },
      offset: { type: "number" },
      multiline: { type: "boolean" },
    },
    required: ["pattern"],
  },
} as const;
