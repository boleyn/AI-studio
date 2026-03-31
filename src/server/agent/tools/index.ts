import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import type { ChangeTracker } from "../globalTools";
import type { AgentToolDefinition } from "./types";
import { getProject } from "@server/projects/projectStorage";
import { searchInFilesSchema, type SearchInFilesInput } from "@server/agent/searchInFiles";
import { ProjectWorkspaceManager } from "../workspace/projectWorkspaceManager";

const listFilesSchema = z.object({});
const readFileSchema = z
  .object({
    path: z.string(),
    mode: z.enum(["auto", "raw"]).optional(),
    maxChars: z.number().int().min(500).max(50000).optional(),
  });
const writeFileSchema = z.object({ path: z.string(), content: z.string() });
const replaceInFileSchema = z.object({ path: z.string(), query: z.string(), replace: z.string() });
const sandpackCompileInfoSchema = z.object({
  includeLogs: z.boolean().optional(),
  includeEvents: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
const CHAT_FILE_MAX_CHARS = 12000;
const CHAT_FILE_BASE64_MAX_BYTES = 200 * 1024;

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

const toReadFilePayload = ({
  mode,
  path,
  buffer,
  contentType,
  maxChars,
}: {
  mode: "auto" | "raw";
  path: string;
  buffer: Buffer;
  contentType: string;
  maxChars: number;
}) => {
  const normalizedType = (contentType || "").toLowerCase();
  const isImage = normalizedType.startsWith("image/");
  const resolvedMode = mode === "auto" ? "raw" : mode;
  const shouldUseUtf8 = !isImage && isLikelyTextContentType(normalizedType);
  const shouldUseBase64 = !shouldUseUtf8;
  if (shouldUseBase64 && buffer.byteLength > CHAT_FILE_BASE64_MAX_BYTES) {
    return {
      ok: false,
      mode: resolvedMode,
      path,
      contentType,
      fileSizeBytes: buffer.byteLength,
      maxBase64Bytes: CHAT_FILE_BASE64_MAX_BYTES,
      message: `附件过大（${buffer.byteLength} bytes），禁止返回 base64。请下载后本地处理。`,
    };
  }

  const content = shouldUseUtf8 ? toUtf8Snippet(buffer, maxChars) : toBase64Snippet(buffer, maxChars);
  return {
    ok: true,
    mode: resolvedMode,
    path,
    contentType,
    content,
    contentEncoding: shouldUseBase64 ? "base64" : "utf8",
    truncated: content.includes("...[truncated]"),
  };
};

const isPathInside = (baseDir: string, targetPath: string) => {
  const relative = path.relative(baseDir, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const readSkillFileIfAllowed = async ({
  pathInput,
  skillBaseDirs,
  maxChars,
}: {
  pathInput: string;
  skillBaseDirs: string[];
  maxChars: number;
}) => {
  if (!pathInput || skillBaseDirs.length === 0) return null;

  const candidates = new Set<string>();
  if (path.isAbsolute(pathInput)) {
    candidates.add(path.resolve(pathInput));
  } else {
    candidates.add(path.resolve(process.cwd(), pathInput));
  }

  for (const candidate of candidates) {
    for (const baseRaw of skillBaseDirs) {
      const baseDir = path.resolve(baseRaw);
      if (!isPathInside(baseDir, candidate)) continue;
      const stat = await fs.stat(candidate).catch(() => null);
      if (!stat?.isFile()) continue;
      const content = await fs.readFile(candidate, "utf8");
      const snippet = content.slice(0, maxChars);
      return {
        ok: true,
        mode: "raw",
        path: candidate,
        source: "skill",
        content: content.length > maxChars ? `${snippet}\n\n...[truncated]` : snippet,
        truncated: content.length > maxChars,
      };
    }
  }

  return null;
};

const toJsonSchema = (schema: z.ZodTypeAny): Record<string, unknown> => {
  if (schema === listFilesSchema) return { type: "object", properties: {} };
  if (schema === readFileSchema) {
    return {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "项目/skill 文件路径（以 / 开头）；附件使用 path=/.files/<文件名>",
        },
        mode: {
          type: "string",
          enum: ["auto", "raw"],
          description:
            "附件读取模式。auto/raw: 图片/二进制返回 base64，文本返回 UTF-8。",
        },
        maxChars: {
          type: "integer",
          minimum: 500,
          maximum: 50000,
          description: "附件内容最大返回字符数（默认 12000）",
        },
      },
      required: ["path"],
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
        query: { type: "string", description: "搜索关键词或正则" },
        regex: { type: "boolean", description: "是否将 query 按正则处理，默认 true（接近 rg）" },
        caseSensitive: { type: "boolean", description: "是否区分大小写，默认 true（接近 rg）" },
        wholeWord: { type: "boolean", description: "是否整词匹配（类似 rg -w）" },
        includeGlobs: { type: "array", items: { type: "string" }, description: "只搜索匹配这些 glob 的路径" },
        excludeGlobs: { type: "array", items: { type: "string" }, description: "排除匹配这些 glob 的路径" },
        contextLines: { type: "integer", minimum: 0, maximum: 5, description: "每条命中返回前后上下文行数" },
        maxResults: { type: "integer", minimum: 1, maximum: 500, description: "全局最大返回命中数" },
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
      name: "list_files",
      description: "列出项目中的所有文件路径。",
      parameters: toJsonSchema(listFilesSchema),
      run: async (input) => {
        const parsed = safeParse(listFilesSchema, input, "list_files");
        if (!parsed.ok) throw new Error(parsed.error);
        await workspaceManager.hydrate(token);
        const files = await workspaceManager.listFiles(token);
        return {
          ok: true,
          action: "list",
          message: `共 ${files.length} 个文件。`,
          data: { files },
        };
      },
    },
    {
      name: "read_file",
      description:
        "读取项目文件、已加载 skill 文件或当前会话附件。项目/skill 文件使用 path；附件使用 storagePath 或 fileName。附件默认按 raw 返回（文本 UTF-8，二进制 base64）。",
      parameters: toJsonSchema(readFileSchema),
      run: async (input) => {
        const parsed = safeParse<{
          path?: string;
          storagePath?: string;
          fileName?: string;
          mode?: "auto" | "raw";
          maxChars?: number;
        }>(readFileSchema, input, "read_file");
        if (!parsed.ok) throw new Error(parsed.error);

        const pathInput = (parsed.data.path || "").trim();
        const storagePathInput = (parsed.data.storagePath || "").trim();
        const fileNameInput = (parsed.data.fileName || "").trim();
        const looksLikeScopedStoragePath = /^\/?chat_uploads\//i.test(pathInput);
        const shouldReadAttachment =
          Boolean(storagePathInput || fileNameInput) || looksLikeScopedStoragePath;

        const mode = parsed.data.mode || "auto";
        const maxChars = parsed.data.maxChars ?? CHAT_FILE_MAX_CHARS;
        if (pathInput && !storagePathInput && !fileNameInput) {
          try {
            await workspaceManager.hydrate(token);
            const file = await workspaceManager.readFile(token, pathInput);
            if (!file) {
              const skillRead = await readSkillFileIfAllowed({
                pathInput,
                skillBaseDirs: options?.skillBaseDirs || [],
                maxChars,
              });
              if (skillRead) return skillRead;
              return { ok: false, action: "read", message: `未找到文件 ${pathInput}` };
            }
            if (/^\/?\.?files\//i.test(pathInput)) {
              const absPath = await workspaceManager.resolvePathInWorkspace(token, pathInput);
              const buffer = await fs.readFile(absPath).catch(() => null);
              if (!buffer) return { ok: false, action: "read", message: `未找到文件 ${pathInput}` };
              return toReadFilePayload({
                mode,
                storagePath: file.path,
                buffer,
                contentType: "",
                maxChars,
              });
            }
            return {
              ok: true,
              action: "read",
              message: `已读取 ${file.path}。`,
              data: { path: file.path, content: file.content },
            };
          } catch (error) {
            const skillRead = await readSkillFileIfAllowed({
              pathInput,
              skillBaseDirs: options?.skillBaseDirs || [],
              maxChars,
            });
            if (skillRead) return skillRead;
            throw error;
          }
        }
        if (!shouldReadAttachment) {
          throw new Error("请提供 path（工作区路径）或 storagePath/fileName（会话附件）。");
        }

        const chatId = (options?.chatId || "").trim();
        if (!chatId) throw new Error("当前会话缺少 chatId，无法读取附件");

        const explicitStorageLooksScoped =
          /^\/?chat_uploads\//i.test(storagePathInput) ||
          /^\/?\.?files\//i.test(storagePathInput);
        let storagePath = storagePathInput || (looksLikeScopedStoragePath ? pathInput.replace(/^\/+/, "") : "");
        if (storagePathInput && !explicitStorageLooksScoped) {
          storagePath = "";
        }
        if (!storagePath) {
          const keyword = (fileNameInput || storagePathInput).toLowerCase();
          const prefix = getChatUploadRoot(token, chatId);
          const allKeys = await listStorageObjectKeysByPrefix({
            prefix,
            bucketType: "private",
          });
          const fileKeys = allKeys.filter(
            (key) => key.includes("/.files/files/") || key.includes("/.files/")
          );
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
        let buffer: Buffer | null = null;
        let contentType = "";
        let loadedPath = normalizedPath;
        let lastError: unknown;
        for (const key of toStorageCandidates(normalizedPath)) {
          try {
            const object = await getObjectFromStorage({
              key,
              bucketType: "private",
            });
            buffer = object.buffer;
            contentType = object.contentType || "";
            loadedPath = key;
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (!buffer) {
          throw (lastError instanceof Error ? lastError : new Error("附件读取失败"));
        }
        return toReadFilePayload({
          mode,
          storagePath: loadedPath,
          buffer,
          contentType,
          maxChars,
        });
      },
    },
    {
      name: "write_file",
      description: "在项目中创建或覆盖文件内容。",
      parameters: toJsonSchema(writeFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ path: string; content: string }>(writeFileSchema, input, "write_file");
        if (!parsed.ok) throw new Error(parsed.error);
        await workspaceManager.hydrate(token);
        const result = await workspaceManager.writeFile(token, parsed.data.path, parsed.data.content);
        changeTracker.paths.add(result.path);
        changeTracker.changed = true;
        return {
          ok: true,
          action: "write",
          message: `已写入 ${result.path}。`,
          data: { path: result.path, bytes: result.bytes },
          uiFiles: { [result.path]: { code: parsed.data.content } },
        };
      },
    },
    {
      name: "replace_in_file",
      description: "替换文件中的指定文本。",
      parameters: toJsonSchema(replaceInFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ path: string; query: string; replace: string }>(
          replaceInFileSchema,
          input,
          "replace_in_file"
        );
        if (!parsed.ok) throw new Error(parsed.error);
        await workspaceManager.hydrate(token);
        const result = await workspaceManager.replaceInFile(
          token,
          parsed.data.path,
          parsed.data.query,
          parsed.data.replace
        );
        if (!result.ok) {
          return {
            ok: false,
            action: "replace",
            message: result.message,
          };
        }
        const latest = await workspaceManager.readFile(token, result.path);
        changeTracker.paths.add(result.path);
        changeTracker.changed = true;
        return {
          ok: true,
          action: "replace",
          message: `已在 ${result.path} 中替换 ${result.replaced} 处。`,
          data: { path: result.path, replaced: result.replaced, bytes: result.bytes },
          uiFiles: latest ? { [result.path]: { code: latest.content } } : {},
        };
      },
    },
    {
      name: "search_in_files",
      description: "在项目中按 rg 风格搜索（支持正则、大小写、glob 过滤、上下文）。",
      parameters: toJsonSchema(searchInFilesSchema),
      run: async (input) => {
        const parsed = safeParse<SearchInFilesInput>(searchInFilesSchema, input, "search_in_files");
        if (!parsed.ok) throw new Error(parsed.error);
        await workspaceManager.hydrate(token);
        return workspaceManager.searchInFiles(token, parsed.data);
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
        }>(sandpackCompileInfoSchema, input, "compile_project");
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
  ];
}
