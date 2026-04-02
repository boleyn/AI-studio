import { promises as fs } from "fs";
import path from "path";
import type { AgentToolDefinition, ChangeTracker } from "./types";
import { getProject } from "@server/projects/projectStorage";
import { ProjectWorkspaceManager } from "../workspace/projectWorkspaceManager";
import {
  buildStructuredPatch,
  claudeCompatSchemas,
  editInputSchema,
  globInputSchema,
  grepInputSchema,
  normalizeClaudeFilePath,
  runClaudeGlob,
  runClaudeGrep,
  selectTextByLines,
  writeInputSchema,
  readInputSchema,
  type EditInput,
  type GrepInput,
  type ReadInput,
  type WriteInput,
  type GlobInput,
} from "./claudeCompat";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const ensureWorkspacePath = (workspaceRoot: string, filePath: string) => {
  const normalized = filePath.startsWith("/") ? filePath : `/${filePath}`;
  if (normalized.includes("\\") || normalized.includes("\0") || normalized.includes("..")) {
    throw new Error("Invalid file path");
  }
  const resolved = path.join(workspaceRoot, normalized.replace(/^\/+/, ""));
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes workspace");
  }
  return { normalized: normalized.replace(/\/{2,}/g, "/"), resolved };
};

const toVirtualPackageJsonContent = (input: {
  projectName?: string;
  dependencies?: Record<string, string>;
}) => {
  const name =
    (input.projectName || "ai-studio-project")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "ai-studio-project";

  return JSON.stringify(
    {
      name,
      private: true,
      version: "0.0.0",
      dependencies: input.dependencies && typeof input.dependencies === "object" ? input.dependencies : {},
    },
    null,
    2
  );
};

const parseJsonInput = <T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } }, input: unknown, toolName: string): T => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`${toolName} input validation failed: ${parsed.error.issues.map((item) => item.message).join("; ")}`);
  }
  return parsed.data;
};

const countOccurrences = (source: string, needle: string) => {
  if (!needle) return 0;
  return source.split(needle).length - 1;
};

const readSkillFileIfAllowed = async ({
  filePath,
  skillBaseDirs,
  offset,
  limit,
}: {
  filePath: string;
  skillBaseDirs: string[];
  offset?: number;
  limit?: number;
}) => {
  if (!path.isAbsolute(filePath) || skillBaseDirs.length === 0) return null;

  for (const baseDirRaw of skillBaseDirs) {
    const baseDir = path.resolve(baseDirRaw);
    const candidate = path.resolve(filePath);
    const relative = path.relative(baseDir, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;

    const stat = await fs.stat(candidate).catch(() => null);
    if (!stat?.isFile()) continue;
    const content = await fs.readFile(candidate, "utf8");
    const selected = selectTextByLines(content, offset, limit);
    return {
      type: "text",
      file: {
        filePath: candidate,
        content: selected.content,
        numLines: selected.numLines,
        startLine: selected.startLine,
        totalLines: selected.totalLines,
      },
    };
  }

  return null;
};

const toReadResultFromBuffer = ({
  filePath,
  buffer,
  offset,
  limit,
}: {
  filePath: string;
  buffer: Buffer;
  offset?: number;
  limit?: number;
}) => {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_MIME_BY_EXT[ext]) {
    return {
      type: "image",
      file: {
        base64: buffer.toString("base64"),
        type: IMAGE_MIME_BY_EXT[ext],
        originalSize: buffer.byteLength,
      },
    };
  }
  if (ext === ".pdf") {
    return {
      type: "pdf",
      file: {
        filePath,
        base64: buffer.toString("base64"),
        originalSize: buffer.byteLength,
      },
    };
  }

  const content = buffer.toString("utf8");
  const selected = selectTextByLines(content, offset, limit);
  return {
    type: "text",
    file: {
      filePath,
      content: selected.content,
      numLines: selected.numLines,
      startLine: selected.startLine,
      totalLines: selected.totalLines,
    },
  };
};

export function createProjectTools(
  token: string,
  changeTracker: ChangeTracker,
  options?: { chatId?: string; skillBaseDirs?: string[]; workspaceManager?: ProjectWorkspaceManager }
): AgentToolDefinition[] {
  const workspaceManager =
    options?.workspaceManager ||
    new ProjectWorkspaceManager({
      fallbackProjectToken: token,
      sessionId: options?.chatId || `project-${token}`,
    });

  return [
    {
      name: "Glob",
      description: "Fast file pattern matching tool.",
      parameters: claudeCompatSchemas.Glob,
      run: async (input) => {
        const parsed = parseJsonInput<GlobInput>(globInputSchema, input, "Glob");
        await workspaceManager.hydrate(token, { force: true });
        const files = await workspaceManager.listFiles(token);
        const output = runClaudeGlob(files, parsed);
        return output;
      },
    },
    {
      name: "Read",
      description: "Read file content with optional line ranges.",
      parameters: claudeCompatSchemas.Read,
      run: async (input) => {
        const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
        const parsed = parseJsonInput<ReadInput>(
          readInputSchema,
          {
            ...payload,
            ...(typeof payload.path === "string" && typeof payload.file_path !== "string"
              ? { file_path: payload.path }
              : {}),
          },
          "Read"
        );

        await workspaceManager.hydrate(token);
        const prepared = await workspaceManager.prepare(token);
        const normalizedPath = normalizeClaudeFilePath({ file_path: parsed.file_path });

        const inWorkspace = ensureWorkspacePath(prepared.workspaceRoot, normalizedPath);
        const stat = await fs.stat(inWorkspace.resolved).catch(() => null);

        if (!stat?.isFile()) {
          if (normalizedPath === "/package.json") {
            const project = await getProject(token);
            if (project) {
              const virtualContent = toVirtualPackageJsonContent({
                projectName: project.name,
                dependencies: project.dependencies || {},
              });
              const selected = selectTextByLines(virtualContent, parsed.offset, parsed.limit);
              return {
                type: "text",
                file: {
                  filePath: normalizedPath,
                  content: selected.content,
                  numLines: selected.numLines,
                  startLine: selected.startLine,
                  totalLines: selected.totalLines,
                },
              };
            }
          }

          const skillResult = await readSkillFileIfAllowed({
            filePath: normalizedPath,
            skillBaseDirs: options?.skillBaseDirs || [],
            offset: parsed.offset,
            limit: parsed.limit,
          });
          if (skillResult) return skillResult;

          throw new Error(`File does not exist: ${normalizedPath}`);
        }

        const buffer = await fs.readFile(inWorkspace.resolved);
        return toReadResultFromBuffer({
          filePath: normalizedPath,
          buffer,
          offset: parsed.offset,
          limit: parsed.limit,
        });
      },
    },
    {
      name: "Write",
      description: "Create or overwrite a file.",
      parameters: claudeCompatSchemas.Write,
      run: async (input) => {
        const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
        const parsed = parseJsonInput<WriteInput>(
          writeInputSchema,
          {
            ...payload,
            ...(typeof payload.path === "string" && typeof payload.file_path !== "string"
              ? { file_path: payload.path }
              : {}),
          },
          "Write"
        );

        await workspaceManager.hydrate(token);
        const targetPath = normalizeClaudeFilePath({ file_path: parsed.file_path });
        const before = await workspaceManager.readFile(token, targetPath);
        const result = await workspaceManager.writeFile(token, targetPath, parsed.content);
        changeTracker.paths.add(result.path);
        changeTracker.changed = true;

        return {
          type: before ? "update" : "create",
          filePath: result.path,
          content: parsed.content,
          originalFile: before ? before.content : null,
          structuredPatch: buildStructuredPatch(before ? before.content : null, parsed.content),
        };
      },
    },
    {
      name: "Edit",
      description: "Replace text in a file.",
      parameters: claudeCompatSchemas.Edit,
      run: async (input) => {
        const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
        const parsed = parseJsonInput<EditInput>(
          editInputSchema,
          {
            ...payload,
            ...(typeof payload.path === "string" && typeof payload.file_path !== "string"
              ? { file_path: payload.path }
              : {}),
          },
          "Edit"
        );

        await workspaceManager.hydrate(token);
        const targetPath = normalizeClaudeFilePath({ file_path: parsed.file_path });
        const existing = await workspaceManager.readFile(token, targetPath);
        if (!existing) {
          throw new Error(`File does not exist: ${targetPath}`);
        }

        if (parsed.old_string === parsed.new_string) {
          throw new Error("No changes to make: old_string and new_string are exactly the same.");
        }

        const source = String(existing.content);
        const matchedCount = countOccurrences(source, parsed.old_string);
        if (matchedCount === 0) {
          throw new Error(`String to replace not found in file. String: ${parsed.old_string}`);
        }

        const replaceAll = parsed.replace_all === true;
        if (matchedCount > 1 && !replaceAll) {
          throw new Error(
            `Found ${matchedCount} matches of the string to replace, but replace_all is false.`
          );
        }

        const nextContent = replaceAll
          ? source.split(parsed.old_string).join(parsed.new_string)
          : source.replace(parsed.old_string, parsed.new_string);

        const writeResult = await workspaceManager.writeFile(token, targetPath, nextContent);
        changeTracker.paths.add(writeResult.path);
        changeTracker.changed = true;

        return {
          filePath: writeResult.path,
          oldString: parsed.old_string,
          newString: parsed.new_string,
          originalFile: source,
          structuredPatch: buildStructuredPatch(source, nextContent),
          userModified: false,
          replaceAll,
        };
      },
    },
    {
      name: "Grep",
      description: "Search file content with ripgrep-like options.",
      parameters: claudeCompatSchemas.Grep,
      run: async (input) => {
        const parsed = parseJsonInput<GrepInput>(grepInputSchema, input, "Grep");
        await workspaceManager.hydrate(token);
        const files = await workspaceManager.listFiles(token);

        const textFiles: Record<string, string> = {};
        for (const filePath of files) {
          const file = await workspaceManager.readFile(token, filePath);
          if (!file) continue;
          textFiles[file.path] = file.content;
        }

        return runClaudeGrep(textFiles, parsed);
      },
    },
  ];
}
