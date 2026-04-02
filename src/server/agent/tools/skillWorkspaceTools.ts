import type { AgentToolDefinition } from "./types";
import {
  runWorkspaceAction,
  type WorkspaceActionInput,
} from "@server/skills/workspaceStorage";
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
  type GlobInput,
  type GrepInput,
  type ReadInput,
  type WriteInput,
} from "./claudeCompat";

const parseJsonInput = <T>(
  schema: {
    safeParse: (
      input: unknown
    ) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } };
  },
  input: unknown,
  toolName: string
): T => {
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

export const createSkillWorkspaceTools = ({
  workspaceId,
  userId,
  projectToken,
  skillId,
}: {
  workspaceId: string;
  userId: string;
  projectToken?: string;
  skillId?: string;
}): AgentToolDefinition[] => {
  const run = (input: WorkspaceActionInput) =>
    runWorkspaceAction(
      {
        workspaceId,
        userId,
        projectToken,
        skillId,
      },
      input
    );

  return [
    {
      name: "Glob",
      description: "Fast file pattern matching tool.",
      parameters: claudeCompatSchemas.Glob,
      run: async (input) => {
        const parsed = parseJsonInput<GlobInput>(globInputSchema, input, "Glob");
        const listed = await run({ action: "list" });
        const files =
          listed &&
          typeof listed === "object" &&
          listed &&
          (listed as { data?: { files?: string[] } }).data &&
          Array.isArray((listed as { data?: { files?: string[] } }).data?.files)
            ? (listed as { data?: { files?: string[] } }).data?.files || []
            : [];
        return runClaudeGlob(files, parsed);
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
        const filePath = normalizeClaudeFilePath({ file_path: parsed.file_path });
        const result = await run({ action: "read", path: filePath });

        const ok = Boolean(result && typeof result === "object" && (result as { ok?: boolean }).ok === true);
        if (!ok) {
          throw new Error(`File does not exist: ${filePath}`);
        }

        const content =
          result && typeof result === "object"
            ? typeof (result as { data?: { content?: string } }).data?.content === "string"
              ? (result as { data?: { content?: string } }).data?.content || ""
              : ""
            : "";
        const selected = selectTextByLines(content, parsed.offset, parsed.limit);
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

        const filePath = normalizeClaudeFilePath({ file_path: parsed.file_path });
        const before = await run({ action: "read", path: filePath });
        const beforeContent =
          before && typeof before === "object" && (before as { ok?: boolean }).ok === true
            ? typeof (before as { data?: { content?: string } }).data?.content === "string"
              ? (before as { data?: { content?: string } }).data?.content || ""
              : ""
            : null;

        const result = await run({ action: "write", path: filePath, content: parsed.content });
        const ok = Boolean(result && typeof result === "object" && (result as { ok?: boolean }).ok === true);
        if (!ok) {
          throw new Error((result as { message?: string })?.message || `Write failed: ${filePath}`);
        }

        return {
          type: beforeContent == null ? "create" : "update",
          filePath,
          content: parsed.content,
          originalFile: beforeContent,
          structuredPatch: buildStructuredPatch(beforeContent, parsed.content),
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

        const filePath = normalizeClaudeFilePath({ file_path: parsed.file_path });
        const before = await run({ action: "read", path: filePath });
        const beforeOk = Boolean(before && typeof before === "object" && (before as { ok?: boolean }).ok === true);
        if (!beforeOk) {
          throw new Error(`File does not exist: ${filePath}`);
        }

        const source =
          typeof (before as { data?: { content?: string } }).data?.content === "string"
            ? (before as { data?: { content?: string } }).data?.content || ""
            : "";

        if (parsed.old_string === parsed.new_string) {
          throw new Error("No changes to make: old_string and new_string are exactly the same.");
        }

        const matchedCount = countOccurrences(source, parsed.old_string);
        if (matchedCount === 0) {
          throw new Error(`String to replace not found in file. String: ${parsed.old_string}`);
        }

        const replaceAll = parsed.replace_all === true;
        if (matchedCount > 1 && !replaceAll) {
          throw new Error(`Found ${matchedCount} matches of the string to replace, but replace_all is false.`);
        }

        const nextContent = replaceAll
          ? source.split(parsed.old_string).join(parsed.new_string)
          : source.replace(parsed.old_string, parsed.new_string);

        const wrote = await run({ action: "write", path: filePath, content: nextContent });
        const ok = Boolean(wrote && typeof wrote === "object" && (wrote as { ok?: boolean }).ok === true);
        if (!ok) {
          throw new Error((wrote as { message?: string })?.message || `Edit failed: ${filePath}`);
        }

        return {
          filePath,
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
        const listed = await run({ action: "list" });
        const files =
          listed &&
          typeof listed === "object" &&
          (listed as { data?: { files?: string[] } }).data &&
          Array.isArray((listed as { data?: { files?: string[] } }).data?.files)
            ? (listed as { data?: { files?: string[] } }).data?.files || []
            : [];

        const textFiles: Record<string, string> = {};
        for (const filePath of files) {
          const readResult = await run({ action: "read", path: filePath });
          if (!readResult || typeof readResult !== "object" || (readResult as { ok?: boolean }).ok !== true) {
            continue;
          }
          const content =
            typeof (readResult as { data?: { content?: string } }).data?.content === "string"
              ? (readResult as { data?: { content?: string } }).data?.content || ""
              : "";
          textFiles[filePath] = content;
        }

        return runClaudeGrep(textFiles, parsed);
      },
    },
  ];
};
