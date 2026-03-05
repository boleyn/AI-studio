import { z } from "zod";
import type { ChangeTracker, GlobalToolInput } from "../globalTools";
import { globalToolSchema, runGlobalAction } from "../globalTools";
import type { AgentToolDefinition } from "./types";
import { getProject } from "@server/projects/projectStorage";
import {
  getObjectFromStorage,
  listStorageObjectKeysByPrefix,
  normalizeStorageKey,
} from "@server/storage/s3";

const listFilesSchema = z.object({});
const readFileSchema = z
  .object({
    path: z.string().optional(),
    storagePath: z.string().optional(),
    fileName: z.string().optional(),
    mode: z.enum(["auto", "markdown", "raw"]).optional(),
    maxChars: z.number().int().min(500).max(50000).optional(),
  })
  .refine(
    (value) =>
      Boolean(
        (value.path || "").trim() || (value.storagePath || "").trim() || (value.fileName || "").trim()
      ),
    {
      message: "path、storagePath、fileName 至少提供一个",
    }
  );
const writeFileSchema = z.object({ path: z.string(), content: z.string() });
const replaceInFileSchema = z.object({ path: z.string(), query: z.string(), replace: z.string() });
const searchInFilesSchema = z.object({ query: z.string(), limit: z.number().int().min(1).max(200).optional() });
const sandpackCompileInfoSchema = z.object({
  includeLogs: z.boolean().optional(),
  includeEvents: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
const CHAT_FILE_MAX_CHARS = 12000;

const toSafeSegment = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";

const getChatUploadRoot = (token: string, chatId: string) =>
  `chat_uploads/${toSafeSegment(token)}/${toSafeSegment(chatId)}/.files`;

const assertChatScopedStoragePath = ({
  storagePath,
  token,
  chatId,
}: {
  storagePath: string;
  token: string;
  chatId: string;
}) => {
  const normalizedPath = normalizeStorageKey(storagePath);
  const expectedPrefix = `${getChatUploadRoot(token, chatId)}/`;
  if (!normalizedPath.startsWith(expectedPrefix)) {
    throw new Error("无权限访问该附件");
  }
  return normalizedPath;
};

const toUtf8Snippet = (buffer: Buffer, maxChars: number) => {
  const raw = buffer.toString("utf8");
  const snippet = raw.slice(0, maxChars);
  return raw.length > maxChars ? `${snippet}\n\n...[truncated]` : snippet;
};
const toBase64Snippet = (buffer: Buffer, maxChars: number) => {
  const raw = buffer.toString("base64");
  const snippet = raw.slice(0, maxChars);
  return raw.length > maxChars ? `${snippet}\n...[truncated]` : snippet;
};
const isLikelyTextContentType = (contentType: string) =>
  contentType.startsWith("text/") ||
  [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-javascript",
    "application/yaml",
    "application/x-yaml",
  ].some((item) => contentType.startsWith(item));

const inferMarkdownPath = (storagePath: string) => {
  if (storagePath.includes("/.files/markdown/")) return storagePath;
  return storagePath.replace("/.files/files/", "/.files/markdown/") + ".md";
};

const toJsonSchema = (schema: z.ZodTypeAny): Record<string, unknown> => {
  if (schema === listFilesSchema) return { type: "object", properties: {} };
  if (schema === readFileSchema) {
    return {
      type: "object",
      properties: {
        path: { type: "string", description: "项目文件路径（以 / 开头）" },
        storagePath: {
          type: "string",
          description: "会话附件 storagePath（优先）",
        },
        fileName: {
          type: "string",
          description: "附件文件名关键词（未提供 storagePath 时用于模糊匹配）",
        },
        mode: {
          type: "string",
          enum: ["auto", "markdown", "raw"],
          description:
            "附件读取模式。auto: 图片返回 base64、docx/pdf/excel 等文档优先 markdown；markdown: 返回解析 markdown；raw: 图片/二进制返回 base64，文本返回 UTF-8",
        },
        maxChars: {
          type: "integer",
          minimum: 500,
          maximum: 50000,
          description: "附件内容最大返回字符数（默认 12000）",
        },
      },
    };
  }
  if (schema === writeFileSchema) {
    return {
      type: "object",
      properties: {
        path: { type: "string", description: "以 / 开头的文件路径" },
        content: { type: "string", description: "写入的完整内容" },
      },
      required: ["path", "content"],
    };
  }
  if (schema === replaceInFileSchema) {
    return {
      type: "object",
      properties: {
        path: { type: "string", description: "以 / 开头的文件路径" },
        query: { type: "string", description: "需要替换的文本" },
        replace: { type: "string", description: "替换后的文本" },
      },
      required: ["path", "query", "replace"],
    };
  }
  if (schema === searchInFilesSchema) {
    return {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "最多返回条数" },
      },
      required: ["query"],
    };
  }
  if (schema === sandpackCompileInfoSchema) {
    return {
      type: "object",
      properties: {
        includeLogs: { type: "boolean", description: "是否返回 console 日志，默认 true" },
        includeEvents: { type: "boolean", description: "是否返回编译事件，默认 true" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "日志与事件最大返回条数，默认 30" },
      },
    };
  }
  return { type: "object" };
};

const safeParse = <T>(schema: z.ZodTypeAny, input: unknown): { ok: true; data: T } | { ok: false; error: string } => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((err) => err.message).join("; ") };
  }
  return { ok: true, data: parsed.data as T };
};

export function createProjectTools(
  token: string,
  changeTracker: ChangeTracker,
  options?: { chatId?: string }
): AgentToolDefinition[] {
  return [
    {
      name: "list_files",
      description: "列出项目中的所有文件路径。",
      parameters: toJsonSchema(listFilesSchema),
      run: async (input) => {
        const parsed = safeParse(listFilesSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return runGlobalAction(token, { action: "list" }, changeTracker);
      },
    },
    {
      name: "read_file",
      description:
        "读取项目文件或当前会话附件。项目文件使用 path；附件使用 storagePath 或 fileName。docx/pdf/excel 等文档默认返回 markdown，图片返回 base64。",
      parameters: toJsonSchema(readFileSchema),
      run: async (input) => {
        const parsed = safeParse<{
          path?: string;
          storagePath?: string;
          fileName?: string;
          mode?: "auto" | "markdown" | "raw";
          maxChars?: number;
        }>(readFileSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);

        const projectPath = (parsed.data.path || "").trim();
        if (projectPath) {
          return runGlobalAction(token, { action: "read", path: projectPath }, changeTracker);
        }

        const chatId = (options?.chatId || "").trim();
        if (!chatId) {
          throw new Error("当前会话缺少 chatId，无法读取附件");
        }
        const mode = parsed.data.mode || "auto";
        const maxChars = parsed.data.maxChars ?? CHAT_FILE_MAX_CHARS;

        let storagePath = (parsed.data.storagePath || "").trim();
        if (!storagePath) {
          const keyword = (parsed.data.fileName || "").trim().toLowerCase();
          const prefix = getChatUploadRoot(token, chatId);
          const allKeys = await listStorageObjectKeysByPrefix({
            prefix,
            bucketType: "private",
          });
          const fileKeys = allKeys.filter((key) => key.includes("/.files/files/"));
          const matched = fileKeys
            .filter((key) => {
              if (!keyword) return true;
              const fileName = key.split("/").pop()?.toLowerCase() || "";
              return fileName.includes(keyword);
            })
            .sort((a, b) => b.localeCompare(a));
          if (matched.length === 0) {
            throw new Error("未找到匹配的会话附件");
          }
          storagePath = matched[0];
        }

        const normalizedPath = assertChatScopedStoragePath({
          storagePath,
          token,
          chatId,
        });
        const { buffer, contentType } = await getObjectFromStorage({
          key: normalizedPath,
          bucketType: "private",
        });
        const normalizedType = (contentType || "").toLowerCase();
        const isImage = normalizedType.startsWith("image/");
        const resolvedMode = mode === "auto" ? (isImage ? "raw" : "markdown") : mode;

        if (resolvedMode === "markdown") {
          const markdownPath = assertChatScopedStoragePath({
            storagePath: inferMarkdownPath(normalizedPath),
            token,
            chatId,
          });
          try {
            const { buffer: markdownBuffer } = await getObjectFromStorage({
              key: markdownPath,
              bucketType: "private",
            });
            const content = toUtf8Snippet(markdownBuffer, maxChars);
            return {
              ok: true,
              mode: resolvedMode,
              storagePath: normalizedPath,
              markdownPath,
              content,
              truncated: content.includes("...[truncated]"),
            };
          } catch {
            return {
              ok: false,
              mode: resolvedMode,
              storagePath: normalizedPath,
              message: "markdown 解析结果不存在，请改用 mode=raw 或先触发解析。",
            };
          }
        }

        const content = isImage
          ? toBase64Snippet(buffer, maxChars)
          : isLikelyTextContentType(normalizedType)
          ? toUtf8Snippet(buffer, maxChars)
          : toBase64Snippet(buffer, maxChars);
        return {
          ok: true,
          mode: resolvedMode,
          storagePath: normalizedPath,
          contentType,
          content,
          contentEncoding: isImage || !isLikelyTextContentType(normalizedType) ? "base64" : "utf8",
          truncated: content.includes("...[truncated]"),
        };
      },
    },
    {
      name: "write_file",
      description: "在项目中创建或覆盖文件内容。",
      parameters: toJsonSchema(writeFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ path: string; content: string }>(writeFileSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return runGlobalAction(
          token,
          { action: "write", path: parsed.data.path, content: parsed.data.content },
          changeTracker
        );
      },
    },
    {
      name: "replace_in_file",
      description: "替换文件中的指定文本。",
      parameters: toJsonSchema(replaceInFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ path: string; query: string; replace: string }>(replaceInFileSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return runGlobalAction(
          token,
          { action: "replace", path: parsed.data.path, query: parsed.data.query, replace: parsed.data.replace },
          changeTracker
        );
      },
    },
    {
      name: "search_in_files",
      description: "在项目中搜索指定关键词。",
      parameters: toJsonSchema(searchInFilesSchema),
      run: async (input) => {
        const parsed = safeParse<{ query: string; limit?: number }>(searchInFilesSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return runGlobalAction(
          token,
          { action: "search", query: parsed.data.query, limit: parsed.data.limit },
          changeTracker
        );
      },
    },
    {
      name: "compile_project",
      description: "编译当前项目代码并返回错误。",
      parameters: toJsonSchema(sandpackCompileInfoSchema),
      run: async (input) => {
        const parsed = safeParse<{
          includeLogs?: boolean;
          includeEvents?: boolean;
          limit?: number;
        }>(sandpackCompileInfoSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);

        const project = await getProject(token);
        if (!project) {
          throw new Error("项目不存在");
        }
        const compileInfo = project.sandpackCompileInfo;
        if (!compileInfo) {
          return {
            ok: false,
            message: "暂无 Sandpack 编译信息。请先在编辑器/预览中触发一次运行后再试。",
          };
        }

        const limit = parsed.data.limit ?? 30;
        const includeLogs = parsed.data.includeLogs !== false;
        const includeEvents = parsed.data.includeEvents !== false;

        return {
          ok: true,
          status: compileInfo.status,
          updatedAt: compileInfo.updatedAt,
          lastEventType: compileInfo.lastEventType || "",
          lastEventText: compileInfo.lastEventText || "",
          errors: compileInfo.errors.slice(-limit),
          events: includeEvents ? compileInfo.events.slice(-limit) : [],
          logs: includeLogs ? compileInfo.logs.slice(-limit) : [],
        };
      },
    },
    {
      name: "global",
      description: "通用文件操作工具，支持 list/read/write/replace/search。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "read", "write", "replace", "search"] },
          path: { type: "string" },
          content: { type: "string" },
          query: { type: "string" },
          replace: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        required: ["action"],
      },
      run: async (input) => {
        const parsed = globalToolSchema.safeParse(input);
        if (!parsed.success) {
          throw new Error(parsed.error.issues.map((err) => err.message).join("; "));
        }
        return runGlobalAction(token, parsed.data as GlobalToolInput, changeTracker);
      },
    },
  ];
}
