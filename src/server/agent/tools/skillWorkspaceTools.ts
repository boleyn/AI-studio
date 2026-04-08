import { z } from "zod";
import type { AgentToolDefinition } from "./types";
import {
  runWorkspaceAction,
  type WorkspaceActionInput,
} from "@server/skills/workspaceStorage";

const listFilesSchema = z
  .object({
    pattern: z.string(),
    path: z.string().optional(),
  })
  .strict();
const readFileSchema = z
  .object({
    file_path: z.string(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
const writeFileSchema = z
  .object({
    file_path: z.string(),
    content: z.string(),
  })
  .strict();
const replaceInFileSchema = z
  .object({
    file_path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  })
  .strict();
const deleteFileSchema = z
  .object({
    file_path: z.string(),
  })
  .strict();
const grepSchema = z
  .object({
    pattern: z.string(),
    path: z.string().optional(),
    glob: z.string().optional(),
    output_mode: z.enum(["content", "files_with_matches", "count"]).optional(),
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
  })
  .strict();

const toJsonSchema = (schema: z.ZodTypeAny): Record<string, unknown> => {
  if (schema === listFilesSchema) {
    return {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Claude Glob: glob 匹配模式，如 **/*.ts" },
        path: { type: "string", description: "Claude Glob: 搜索目录（可选）" },
      },
      required: ["pattern"],
    };
  }
  if (schema === readFileSchema) {
    return {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Claude Read: 绝对文件路径" },
        offset: { type: "integer", minimum: 0, description: "Claude 风格字段：读取起始行号（默认 1）" },
        limit: { type: "integer", minimum: 1, description: "Claude 风格字段：读取行数限制" },
      },
      required: ["file_path"],
    };
  }
  if (schema === writeFileSchema) {
    return {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Claude Write: 绝对文件路径" },
        content: {
          type: "string",
          description:
            "写入的完整内容。仅用于新文件或完整重写；不要在同一轮并行多个 Write，尽量拆分为小文件/多次调用。",
        },
      },
      required: ["file_path", "content"],
    };
  }
  if (schema === replaceInFileSchema) {
    return {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Claude Edit: 要修改的文件绝对路径",
        },
        old_string: { type: "string", description: "Claude Edit: 被替换原文" },
        new_string: { type: "string", description: "Claude Edit: 替换后文本" },
        replace_all: { type: "boolean", description: "Claude Edit: 是否替换全部匹配（默认 false）" },
      },
      required: ["file_path", "old_string", "new_string"],
    };
  }
  if (schema === deleteFileSchema) {
    return {
      type: "object",
      properties: {
        file_path: { type: "string", description: "要删除的文件绝对路径" },
      },
      required: ["file_path"],
    };
  }
  if (schema === grepSchema) {
    return {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        glob: { type: "string" },
        output_mode: { type: "string", enum: ["content", "files_with_matches", "count"] },
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
    };
  }
  return {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词或正则" },
      regex: { type: "boolean", description: "是否按正则处理，默认 true" },
      caseSensitive: { type: "boolean", description: "是否区分大小写，默认 true" },
      wholeWord: { type: "boolean", description: "是否整词匹配" },
      includeGlobs: { type: "array", items: { type: "string" }, description: "只搜索匹配这些 glob 的路径" },
      excludeGlobs: { type: "array", items: { type: "string" }, description: "排除匹配这些 glob 的路径" },
      contextLines: { type: "integer", minimum: 0, maximum: 5, description: "返回前后上下文行数" },
      maxResults: { type: "integer", minimum: 1, maximum: 500, description: "全局最大返回命中数" },
    },
    required: ["query"],
  };
};

const describeInputType = (input: unknown) => {
  if (input === null) return "null";
  if (Array.isArray(input)) return "array";
  return typeof input;
};

const toInputPreview = (input: unknown, maxLen = 200) => {
  try {
    const raw =
      typeof input === "string" ? input : JSON.stringify(input);
    if (!raw) return "";
    return raw.length > maxLen ? `${raw.slice(0, maxLen)}...` : raw;
  } catch {
    return String(input);
  }
};

const safeParse = <T>(
  schema: z.ZodTypeAny,
  input: unknown,
  toolName = "unknown_tool"
): { ok: true; data: T } | { ok: false; error: string } => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const inputType = describeInputType(input);
    const inputPreview = toInputPreview(input);
    console.warn("[agent-tool][validation-error]", {
      toolName,
      inputType,
      inputPreview,
      issues: parsed.error.issues,
    });

    const invalidObjectIssue = parsed.error.issues.find(
      (issue) =>
        issue.code === "invalid_type" &&
        "expected" in issue &&
        issue.expected === "object"
    );
    if (invalidObjectIssue) {
      const preview = toInputPreview(input);
      const previewSuffix = preview ? `；收到片段: ${preview}` : "";
      return {
        ok: false,
        error:
          `工具入参类型错误：期望 JSON 对象(object)，实际收到 ${describeInputType(input)}。` +
          `请把 arguments 作为对象传入，而不是字符串。示例：{"path":"/App.js","content":"..."}${previewSuffix}`,
      };
    }
    return { ok: false, error: parsed.error.issues.map((err) => err.message).join("; ") };
  }
  return { ok: true, data: parsed.data as T };
};

const sliceContentByLineRange = (content: string, offset?: number, limit?: number) => {
  const allLines = content.split("\n");
  const totalLines = allLines.length;
  const startLine = offset && offset > 0 ? offset : 1;
  const startIndex = Math.max(0, startLine - 1);
  const endIndex = typeof limit === "number" ? startIndex + Math.max(0, limit) : undefined;
  const selectedLines = allLines.slice(startIndex, endIndex);
  return {
    content: selectedLines.join("\n"),
    startLine,
    numLines: selectedLines.length,
    totalLines,
  };
};

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
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  out += "$";
  return new RegExp(out);
};

const normalizeSearchRoot = (value?: string) => {
  const raw = (value || "").trim();
  if (!raw) return "";
  return raw.startsWith("/") ? raw.replace(/\/+$/, "") : `/${raw.replace(/^\/+/, "").replace(/\/+$/, "")}`;
};

const splitGlobPatterns = (value?: string) =>
  (value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

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
      description: "列出 workspace 中所有文件路径。",
      parameters: toJsonSchema(listFilesSchema),
      run: async (input) => {
        const parsed = safeParse<{ pattern: string; path?: string }>(listFilesSchema, input, "Glob");
        if (!parsed.ok) throw new Error(parsed.error);
        const listed = await run({ action: "list" });
        const files = (listed as any)?.data?.files || [];
        const root = normalizeSearchRoot(parsed.data.path);
        const matcher = globToRegExp(parsed.data.pattern);
        const filenames = files.filter((filePath: string) => {
          if (root && !(filePath === root || filePath.startsWith(`${root}/`))) return false;
          const relative = root ? filePath.slice(root.length).replace(/^\/+/, "") : filePath.replace(/^\/+/, "");
          return matcher.test(relative) || matcher.test(filePath);
        });
        return {
          ok: true,
          action: "list",
          message: `匹配到 ${filenames.length} 个文件。`,
          durationMs: 0,
          numFiles: filenames.length,
          filenames,
          truncated: false,
          data: { files: filenames },
        };
      },
    },
    {
      name: "Read",
      description: "读取 workspace 文件内容。",
      parameters: toJsonSchema(readFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ file_path: string; offset?: number; limit?: number }>(
          readFileSchema,
          input,
          "Read"
        );
        if (!parsed.ok) throw new Error(parsed.error);
        const path = parsed.data.file_path;
        const result = await run({ action: "read", path });
        if (!result?.ok || result.action !== "read") return result;
        const content = String((result as any).data?.content || "");
        const ranged = sliceContentByLineRange(content, parsed.data.offset, parsed.data.limit);
        return {
          ...result,
          type: "text",
          file: {
            filePath: (result as any).data?.path || path,
            content: ranged.content,
            numLines: ranged.numLines,
            startLine: ranged.startLine,
            totalLines: ranged.totalLines,
          },
          data: {
            ...(result as any).data,
            content: ranged.content,
          },
        };
      },
    },
    {
      name: "Write",
      description:
        "写入或覆盖 workspace 文件。优先用于新文件或完整重写；修改已有文件优先使用 Edit。若写已有文件，先用 Read 读取当前内容再写回。禁止在同一轮并行多个 Write；一次只写一个文件。",
      parameters: toJsonSchema(writeFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ file_path: string; content: string }>(
          writeFileSchema,
          input,
          "Write"
        );
        if (!parsed.ok) throw new Error(parsed.error);
        const path = parsed.data.file_path;
        const previous = await run({ action: "read", path });
        const result = await run({
          action: "write",
          path,
          content: parsed.data.content,
        });
        if (!result?.ok) return result;
        const previousContent = previous?.ok && (previous as any).action === "read" ? (previous as any).data?.content : null;
        return {
          ...result,
          type: previousContent == null ? "create" : "update",
          filePath: (result as any).data?.path || path,
          content: parsed.data.content,
          structuredPatch: [],
          originalFile: previousContent,
        };
      },
    },
    {
      name: "Edit",
      description:
        "替换 workspace 文件中的指定文本（优先用于修改已有文件，避免整文件重写）。请先 Read 确认上下文后再替换；保持单次替换聚焦。",
      parameters: toJsonSchema(replaceInFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ file_path: string; old_string: string; new_string: string; replace_all?: boolean }>(
          replaceInFileSchema,
          input,
          "Edit"
        );
        if (!parsed.ok) throw new Error(parsed.error);
        const path = parsed.data.file_path;
        const query = parsed.data.old_string;
        const replace = parsed.data.new_string;
        const replaceAll = parsed.data.replace_all ?? false;
        const before = await run({ action: "read", path });
        const result = await run({
          action: "replace",
          path,
          query,
          replace,
          replaceAll,
        });
        if (!result?.ok) return result;
        const originalFile = before?.ok && (before as any).action === "read" ? String((before as any).data?.content || "") : "";
        return {
          ...result,
          filePath: (result as any).data?.path || path,
          oldString: query,
          newString: replace,
          originalFile,
          structuredPatch: [],
          userModified: false,
          replaceAll,
        };
      },
    },
    {
      name: "Delete",
      description: "删除 workspace 文件（Claude Delete：仅支持 file_path）。",
      parameters: toJsonSchema(deleteFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ file_path: string }>(deleteFileSchema, input, "Delete");
        if (!parsed.ok) throw new Error(parsed.error);
        const path = parsed.data.file_path;
        return run({
          action: "delete",
          path,
        });
      },
    },
    {
      name: "Grep",
      description: "在 workspace 内按 rg 风格搜索（正则、glob、上下文）。",
      parameters: toJsonSchema(grepSchema),
      run: async (input) => {
        const parsed = safeParse<{
          pattern: string;
          path?: string;
          glob?: string;
          output_mode?: "content" | "files_with_matches" | "count";
          "-A"?: number;
          "-B"?: number;
          "-C"?: number;
          context?: number;
          "-n"?: boolean;
          "-i"?: boolean;
          head_limit?: number;
          offset?: number;
        }>(grepSchema, input, "Grep");
        if (!parsed.ok) throw new Error(parsed.error);
        const includeGlobs = splitGlobPatterns(parsed.data.glob);
        const root = normalizeSearchRoot(parsed.data.path);
        if (root) includeGlobs.push(root, `${root}/**`);
        const contextFromFlags =
          typeof parsed.data["-C"] === "number"
            ? parsed.data["-C"]
            : typeof parsed.data.context === "number"
            ? parsed.data.context
            : Math.max(parsed.data["-A"] || 0, parsed.data["-B"] || 0);
        const headLimit = typeof parsed.data.head_limit === "number" ? parsed.data.head_limit : 250;
        const maxResults = headLimit <= 0 ? 500 : Math.min(Math.max(1, Math.floor(headLimit)), 500);
        const offset = Math.max(0, Math.floor(parsed.data.offset || 0));
        const search = await run({
          action: "search",
          query: parsed.data.pattern,
          regex: true,
          caseSensitive: parsed.data["-i"] ? false : true,
          wholeWord: false,
          includeGlobs: includeGlobs.length > 0 ? includeGlobs : undefined,
          contextLines: Math.min(5, Math.max(0, Math.floor(contextFromFlags || 0))),
          maxResults,
        });
        const outputMode = parsed.data.output_mode || "files_with_matches";
        const rawResults = (search as any)?.data?.results || [];
        const sliced = rawResults.slice(offset);
        const filenames = sliced.map((item: any) => item.path);
        if (outputMode === "count") {
          const content = sliced
            .map((item: any) => `${item.path}:${Array.isArray(item.matches) ? item.matches.length : 0}`)
            .join("\n");
          return {
            mode: "count",
            numFiles: filenames.length,
            filenames,
            numMatches: sliced.reduce(
              (acc: number, item: any) => acc + (Array.isArray(item.matches) ? item.matches.length : 0),
              0
            ),
            content,
            appliedLimit: maxResults,
            appliedOffset: offset || undefined,
          };
        }
        if (outputMode === "content") {
          const showLineNumber = parsed.data["-n"] !== false;
          const content = sliced
            .flatMap((item: any) =>
              (item.matches || []).map((match: any) =>
                showLineNumber ? `${item.path}:${match.line}:${match.snippet}` : `${item.path}:${match.snippet}`
              )
            )
            .join("\n");
          return {
            mode: "content",
            numFiles: filenames.length,
            filenames,
            content,
            numLines: content ? content.split("\n").length : 0,
            appliedLimit: maxResults,
            appliedOffset: offset || undefined,
          };
        }
        return {
          mode: "files_with_matches",
          numFiles: filenames.length,
          filenames,
          appliedLimit: maxResults,
          appliedOffset: offset || undefined,
        };
      },
    },
  ];
};
