import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import type { AgentToolDefinition, ChangeTracker } from "./types";
import { getProject } from "@server/projects/projectStorage";
import { ProjectWorkspaceManager } from "../workspace/projectWorkspaceManager";
import { getObjectFromStorage } from "@server/storage/s3";
import { assertChatScopedStoragePath, toSafeFileName } from "../../../pages/api/core/chat/files/shared";
import { getAgentRuntimeConfig } from "@server/agent/runtimeConfig";
import { getChatModelCatalog, getChatModelProfile } from "@server/aiProxy/catalogStore";
import { getAIApi } from "@aistudio/ai/config";
import { DEFAULT_TOOL_TIMEOUT_MS, runExecFile } from "./commandRunner";
import {
  clearReadSnapshot,
  createReadSnapshotStore,
  ensureAbsoluteFilePath,
  getReadSnapshot,
  markReadSnapshot,
} from "./readState";

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
    pages: z.string().optional(),
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
const sandpackCompileInfoSchema = z.object({
  includeLogs: z.boolean().optional(),
  includeEvents: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
const CHAT_FILE_MAX_CHARS = 12000;
const CHAT_FILE_BASE64_MAX_BYTES = 200 * 1024;
const CHAT_FILE_VISION_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_READ_FILE_VISION_PROMPT =
  "你是图片理解助手。请准确提取图片中的文字与关键信息，若是界面截图请给出主要内容和状态，输出中文。";

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

const inferImageContentTypeFromPath = (filePath: string) => {
  const ext = path.extname(filePath || "").toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
};

const inferContentTypeFromPath = (filePath: string) => {
  const ext = path.extname(filePath || "").toLowerCase();
  if (
    [
      ".txt",
      ".md",
      ".markdown",
      ".json",
      ".xml",
      ".yaml",
      ".yml",
      ".csv",
      ".tsv",
      ".js",
      ".mjs",
      ".cjs",
      ".ts",
      ".tsx",
      ".jsx",
      ".css",
      ".html",
      ".htm",
      ".py",
      ".sh",
      ".sql",
    ].includes(ext)
  ) {
    return "text/plain";
  }
  return inferImageContentTypeFromPath(filePath);
};

const toStorageCandidates = (normalizedPath: string) => {
  const result = new Set<string>([normalizedPath]);
  const marker = "/.files/files/";
  if (normalizedPath.includes(marker)) {
    result.add(normalizedPath.replace(marker, "/.files/"));
  } else if (normalizedPath.includes("/.files/")) {
    result.add(normalizedPath.replace("/.files/", marker));
  }
  return [...result];
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const toString = (value: unknown) => (typeof value === "string" ? value : "");

const buildAttachmentStoragePathLookup = (messages?: unknown[]) => {
  const lookup = new Map<string, string>();
  if (!Array.isArray(messages)) return lookup;

  for (const message of messages) {
    const messageRecord = toRecord(message);
    if (!messageRecord) continue;
    if (toString(messageRecord.role) !== "user") continue;
    const artifact = toRecord(messageRecord.artifact);
    if (!artifact) continue;
    const files = Array.isArray(artifact.files) ? artifact.files : [];
    for (const file of files) {
      const fileRecord = toRecord(file);
      if (!fileRecord) continue;
      const storagePath = toString(fileRecord.storagePath).replace(/^\/+/, "");
      if (!storagePath) continue;
      const fileName = toSafeFileName(
        toString(fileRecord.name) || path.posix.basename(storagePath)
      );
      const workspacePath = `/.files/${fileName}`;
      lookup.set(workspacePath, storagePath);
      lookup.set(workspacePath.replace("/.files/", "/files/"), storagePath);
    }
  }

  return lookup;
};

const resolveReadFileVisionModelCandidates = async () => {
  const runtime = getAgentRuntimeConfig();
  const toolProfile = getChatModelProfile(runtime.toolCallModel) as Record<string, unknown> | undefined;
  const normalProfile = getChatModelProfile(runtime.normalModel) as Record<string, unknown> | undefined;
  const fromProfile = (profile?: Record<string, unknown>) =>
    typeof profile?.visionModel === "string" && profile.visionModel.trim()
      ? profile.visionModel.trim()
      : undefined;
  const catalog = await getChatModelCatalog().catch(() => null);
  const visionModels = (catalog?.models || [])
    .filter((item) => {
    const profile = getChatModelProfile(item.id) as Record<string, unknown> | undefined;
    return profile?.vision === true;
    })
    .map((item) => item.id);

  const candidates = [
    fromProfile(toolProfile),
    fromProfile(normalProfile),
    ...visionModels,
    runtime.toolCallModel,
    runtime.normalModel,
    catalog?.defaultModel,
    catalog?.models?.[0]?.id,
  ].filter((item): item is string => Boolean(item && item.trim()));

  return Array.from(new Set(candidates));
};

const isModelUnavailableError = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /does not exist|do not have access|model.*not found|404/i.test(text);
};

const resolveReadFileVisionPrompt = ({
  modelId,
  runtimePrompt,
}: {
  modelId: string;
  runtimePrompt?: string;
}) => {
  void modelId;
  const toolPrompt = (runtimePrompt || "").trim();
  if (toolPrompt) return toolPrompt;
  return DEFAULT_READ_FILE_VISION_PROMPT;
};

const readImageByVision = async ({
  storagePath,
  buffer,
  contentType,
  maxChars,
  prompt,
}: {
  storagePath: string;
  buffer: Buffer;
  contentType: string;
  maxChars: number;
  prompt?: string;
}) => {
  if (buffer.byteLength > CHAT_FILE_VISION_MAX_BYTES) {
    return {
      ok: false,
      mode: "vision",
      storagePath,
      contentType,
      fileSizeBytes: buffer.byteLength,
      maxVisionBytes: CHAT_FILE_VISION_MAX_BYTES,
      message: `图片过大（${buffer.byteLength} bytes），超过视觉识别限制。`,
    };
  }

  const modelCandidates = await resolveReadFileVisionModelCandidates();
  if (modelCandidates.length === 0) {
    throw new Error("未找到可用的视觉模型候选");
  }
  const ai = getAIApi({ timeout: 120000 });
  const mime = (contentType || "").startsWith("image/") ? contentType : inferImageContentTypeFromPath(storagePath);
  const imageDataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
  let response: Awaited<ReturnType<typeof ai.chat.completions.create>> | null = null;
  let usedModel = "";
  let lastError: unknown = null;
  for (const candidate of modelCandidates) {
    try {
      response = await ai.chat.completions.create({
        model: candidate,
        temperature: 0,
        stream: false,
        messages: [
          {
            role: "system",
            content: resolveReadFileVisionPrompt({
              modelId: candidate,
              runtimePrompt: prompt,
            })
          },
          {
            role: "user",
            content: [
              { type: "text", text: "请识别这张图片并给出要点。" },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
      } as any);
      usedModel = candidate;
      break;
    } catch (error) {
      lastError = error;
      if (isModelUnavailableError(error)) {
        continue;
      }
      throw error;
    }
  }
  if (!response) {
    throw new Error(
      `视觉模型不可用，候选: ${modelCandidates.join(", ")}; lastError: ${String(
        lastError instanceof Error ? lastError.message : lastError
      )}`
    );
  }

  const content = (response.choices?.[0]?.message?.content || "").trim();
  const snippet = content.slice(0, maxChars);
  return {
    ok: true,
    mode: "vision",
    storagePath,
    contentType: mime,
    model: usedModel,
    content: content.length > maxChars ? `${snippet}\n\n...[truncated]` : content,
    truncated: content.length > maxChars,
  };
};

const toReadFilePayload = ({
  mode,
  storagePath,
  buffer,
  contentType,
  maxChars,
}: {
  mode: "auto" | "raw" | "vision";
  storagePath: string;
  buffer: Buffer;
  contentType: string;
  maxChars: number;
}) => {
  const normalizedType = (contentType || "").toLowerCase();
  const isImage = normalizedType.startsWith("image/");
  const resolvedMode = mode === "vision" ? "raw" : mode === "auto" ? "raw" : mode;
  const shouldUseUtf8 = !isImage && isLikelyTextContentType(normalizedType);
  const shouldUseBase64 = !shouldUseUtf8;
  if (shouldUseBase64 && buffer.byteLength > CHAT_FILE_BASE64_MAX_BYTES) {
    return {
      ok: false,
      mode: resolvedMode,
      storagePath,
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
    storagePath,
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
  if (schema === listFilesSchema) {
    return {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Claude Glob: glob 匹配模式，如 **/*.ts" },
        path: {
          type: "string",
          description: "Claude Glob: 搜索目录（可选）。不传则在当前工作区根目录搜索",
        },
      },
      required: ["pattern"],
    };
  }
  if (schema === readFileSchema) {
    return {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Claude Read: 要读取的绝对文件路径",
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: "Claude 风格字段：读取起始行号（默认 1）",
        },
        limit: {
          type: "integer",
          minimum: 1,
          description: "Claude 风格字段：读取行数限制",
        },
        pages: { type: "string", description: "Claude Read: PDF 页码范围（可选），当前预留字段" },
      },
      required: ["file_path"],
    };
  }
  if (schema === writeFileSchema) {
    return {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Claude Write: 要写入的绝对文件路径",
        },
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
        pattern: { type: "string", description: "Claude Grep: 正则模式（ripgrep 语义）" },
        path: { type: "string", description: "Claude Grep: 搜索目录/文件（可选）" },
        glob: { type: "string", description: "Claude Grep: 文件过滤 glob（可选）" },
        output_mode: { type: "string", enum: ["content", "files_with_matches", "count"] },
        "-B": { type: "number", description: "前文行数" },
        "-A": { type: "number", description: "后文行数" },
        "-C": { type: "number", description: "上下文行数" },
        context: { type: "number", description: "上下文行数（同 -C）" },
        "-n": { type: "boolean", description: "content 模式显示行号，默认 true" },
        "-i": { type: "boolean", description: "忽略大小写（case-insensitive）" },
        type: { type: "string", description: "文件类型过滤（当前仅透传保留）" },
        head_limit: { type: "number", description: "最多返回条目数，默认 250，0 代表不主动截断（仍受系统上限）" },
        offset: { type: "number", description: "跳过前 N 条后返回" },
        multiline: { type: "boolean", description: "多行匹配（当前仅透传保留）" },
      },
      required: ["pattern"],
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

let resolvedRipgrepCommand: string | null | undefined;

const resolveRipgrepCommand = async () => {
  if (resolvedRipgrepCommand !== undefined) return resolvedRipgrepCommand;
  const candidates = [
    process.env.RIPGREP_PATH,
    process.env.RG_PATH,
    "/usr/bin/rg",
    "/usr/local/bin/rg",
    "/opt/homebrew/bin/rg",
    "/Applications/Codex.app/Contents/Resources/rg",
    "rg",
  ]
    .map((item) => (item || "").trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const probe = await runExecFile({
      command: candidate,
      args: ["--version"],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });
    if (probe.ok) {
      resolvedRipgrepCommand = candidate;
      return resolvedRipgrepCommand;
    }
  }
  resolvedRipgrepCommand = null;
  return null;
};

const normalizeFsPath = (value: string) => value.replace(/\\/g, "/");

const toWorkspacePublicPath = (workspaceRoot: string, absoluteFilePath: string) => {
  const root = normalizeFsPath(path.resolve(workspaceRoot)).replace(/\/+$/, "");
  const resolved = normalizeFsPath(path.resolve(absoluteFilePath));
  if (!(resolved === root || resolved.startsWith(`${root}/`))) return null;
  const relative = resolved.slice(root.length).replace(/^\/+/, "");
  return relative ? `/${relative}` : "/";
};

const replaceAtMostOnce = (source: string, oldString: string, newString: string) => {
  const index = source.indexOf(oldString);
  if (index < 0) return { content: source, replaced: 0 };
  return {
    content: `${source.slice(0, index)}${newString}${source.slice(index + oldString.length)}`,
    replaced: 1,
  };
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
  const dependencies =
    input.dependencies && typeof input.dependencies === "object" ? input.dependencies : {};

  return JSON.stringify(
    {
      name,
      private: true,
      version: "0.0.0",
      dependencies,
    },
    null,
    2
  );
};

export function createProjectTools(
  token: string,
  changeTracker: ChangeTracker,
  options?: {
    chatId?: string;
    skillBaseDirs?: string[];
    workspaceManager?: ProjectWorkspaceManager;
    historyMessages?: unknown[];
  }
): AgentToolDefinition[] {
  const workspaceManager =
    options?.workspaceManager ||
    new ProjectWorkspaceManager({
      fallbackProjectToken: token,
      sessionId: options?.chatId || `project-${token}`,
    });
  const readSnapshots = createReadSnapshotStore(options?.historyMessages);
  const attachmentStoragePathLookup = buildAttachmentStoragePathLookup(options?.historyMessages);

  return [
    {
      name: "Glob",
      description: "列出项目中的所有文件路径。",
      parameters: toJsonSchema(listFilesSchema),
      run: async (input) => {
        const parsed = safeParse<{ pattern: string; path?: string }>(listFilesSchema, input, "Glob");
        if (!parsed.ok) throw new Error(parsed.error);
        if (typeof parsed.data.path === "string" && parsed.data.path.trim()) {
          ensureAbsoluteFilePath(parsed.data.path, "path");
        }
        await workspaceManager.hydrate(token, { force: true });
        const limit = 100;
        const workspaceRoot = await workspaceManager.resolveCwd(token, ".");
        const searchDir = await workspaceManager.resolveCwd(token, parsed.data.path || ".");
        const rgCommand = await resolveRipgrepCommand();
        if (!rgCommand) {
          throw new Error("ripgrep (rg) 不可用：请安装 rg 或配置 RIPGREP_PATH/RG_PATH");
        }

        const rgResult = await runExecFile({
          command: rgCommand,
          args: [
            "--files",
            "--glob",
            parsed.data.pattern,
            "--sort=modified",
            "--no-ignore",
            "--hidden",
          ],
          cwd: searchDir,
          timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
        });

        if (!rgResult.ok && rgResult.exitCode !== 1) {
          throw new Error(rgResult.error || rgResult.stderr || "Glob 搜索失败");
        }
        const lines = (rgResult.stdout || "")
          .split(/\r?\n/g)
          .map((line) => line.trim())
          .filter(Boolean);
        const matchedFiles = lines
          .map((line) => path.resolve(searchDir, line))
          .map((absPath) => toWorkspacePublicPath(workspaceRoot, absPath))
          .filter((item): item is string => Boolean(item));
        const uniqueFiles = Array.from(new Set(matchedFiles));
        const truncated = uniqueFiles.length > limit;
        const filenames = uniqueFiles.slice(0, limit);
        return {
          ok: true,
          action: "list",
          message: `匹配到 ${filenames.length} 个文件。`,
          durationMs: 0,
          numFiles: filenames.length,
          filenames,
          truncated,
          data: { files: filenames, truncated },
        };
      },
    },
    {
      name: "Read",
      description:
        "读取项目文件或当前会话附件（Claude Read 风格）。",
      parameters: toJsonSchema(readFileSchema),
      run: async (input) => {
        const parsed = safeParse<{
          file_path: string;
          offset?: number;
          limit?: number;
          pages?: string;
        }>(readFileSchema, input, "Read");
        if (!parsed.ok) throw new Error(parsed.error);

        const pathInput = ensureAbsoluteFilePath(parsed.data.file_path, "file_path");
        const normalizedWorkspaceAttachmentPath = pathInput.replace(/^\/?files\//i, "/.files/");
        const mappedStoragePath = attachmentStoragePathLookup.get(normalizedWorkspaceAttachmentPath);
        const looksLikeScopedStoragePath = /^\/?chat_uploads\//i.test(pathInput);
        const shouldReadAttachment = looksLikeScopedStoragePath || Boolean(mappedStoragePath);

        const mode: "auto" = "auto";
        const maxChars = CHAT_FILE_MAX_CHARS;
        const offset = parsed.data.offset;
        const limit = parsed.data.limit;
        if (!shouldReadAttachment) {
          try {
            await workspaceManager.hydrate(token, { force: true });
            if (/^\/?\.?files\//i.test(pathInput) || /^\/?files\//i.test(pathInput)) {
              const absPath = await workspaceManager.resolvePathInWorkspace(
                token,
                normalizedWorkspaceAttachmentPath
              );
              const buffer = await fs.readFile(absPath).catch(() => null);
              if (buffer) {
                const localContentType = inferContentTypeFromPath(absPath).toLowerCase();
                if (localContentType.startsWith("image/")) {
                  return await readImageByVision({
                    storagePath: normalizedWorkspaceAttachmentPath,
                    buffer,
                    contentType: localContentType,
                    maxChars,
                    prompt: undefined,
                  });
                }
                return toReadFilePayload({
                  mode,
                  storagePath: normalizedWorkspaceAttachmentPath,
                  buffer,
                  contentType: localContentType,
                  maxChars,
                });
              }
            }
            const file = await workspaceManager.readFile(token, pathInput);
            if (!file) {
              const normalizedPath = pathInput.startsWith("/") ? pathInput : `/${pathInput}`;
              if (normalizedPath === "/package.json") {
                const project = await getProject(token);
                if (project) {
                  const packageJsonContent = toVirtualPackageJsonContent({
                    projectName: project.name,
                    dependencies: project.dependencies || {},
                  });
                  const packageJsonLines = packageJsonContent.split("\n");
                  return {
                    ok: true,
                    action: "read",
                    message: "已读取 /package.json（运行时生成）。",
                    type: "text",
                    file: {
                      filePath: "/package.json",
                      content: packageJsonContent,
                      numLines: packageJsonLines.length,
                      startLine: 1,
                      totalLines: packageJsonLines.length,
                    },
                    data: {
                      path: "/package.json",
                      content: packageJsonContent,
                    },
                  };
                }
              }
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
                contentType: inferContentTypeFromPath(absPath),
                maxChars,
              });
            }
            const ranged = sliceContentByLineRange(String(file.content || ""), offset, limit);
            const isPartial = ranged.startLine > 1 || ranged.numLines < ranged.totalLines;
            markReadSnapshot(readSnapshots, {
              filePath: file.path,
              content: String(file.content || ""),
              isPartial,
            });
            return {
              ok: true,
              action: "read",
              message: `已读取 ${file.path}。`,
              type: "text",
              file: {
                filePath: file.path,
                content: ranged.content,
                numLines: ranged.numLines,
                startLine: ranged.startLine,
                totalLines: ranged.totalLines,
              },
              data: { path: file.path, content: ranged.content },
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

        const chatId = (options?.chatId || "").trim();
        if (!chatId) throw new Error("当前会话缺少 chatId，无法读取附件");
        const storagePath = (mappedStoragePath || pathInput).replace(/^\/+/, "");

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
        const normalizedContentType = (contentType || inferImageContentTypeFromPath(loadedPath)).toLowerCase();
        if (normalizedContentType.startsWith("image/")) {
          return await readImageByVision({
            storagePath: loadedPath,
            buffer,
            contentType: normalizedContentType,
            maxChars,
            prompt: undefined,
          });
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
      name: "Write",
      description:
        "在项目中创建或覆盖文件内容。优先用于新文件或完整重写；修改已有文件优先使用 Edit。若写已有文件，先用 Read 读取当前内容再写回。禁止在同一轮并行多个 Write；一次只写一个文件，复杂改动拆分到多个小文件/多次调用。",
      parameters: toJsonSchema(writeFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ file_path: string; content: string }>(
          writeFileSchema,
          input,
          "Write"
        );
        if (!parsed.ok) throw new Error(parsed.error);
        await workspaceManager.hydrate(token);
        const targetPath = ensureAbsoluteFilePath(parsed.data.file_path, "file_path");
        const previous = await workspaceManager.readFile(token, targetPath);
        if (previous) {
          const snapshot = getReadSnapshot(readSnapshots, previous.path);
          if (!snapshot) {
            return {
              ok: false,
              action: "write",
              message: "File has not been read yet. Read it first before writing to it.",
            };
          }
          if (snapshot.isPartial) {
            return {
              ok: false,
              action: "write",
              message: "File was read partially. Read the full file before writing to it.",
            };
          }
          if (snapshot.content !== String(previous.content || "")) {
            return {
              ok: false,
              action: "write",
              message: "File has been modified since read. Read it again before attempting to write it.",
            };
          }
        }
        const result = await workspaceManager.writeFile(token, targetPath, parsed.data.content);
        const type = previous ? "update" : "create";
        markReadSnapshot(readSnapshots, {
          filePath: result.path,
          content: parsed.data.content,
          isPartial: false,
        });
        changeTracker.paths.add(result.path);
        changeTracker.changed = true;
        return {
          ok: true,
          action: "write",
          message: `已写入 ${result.path}。`,
          type,
          filePath: result.path,
          content: parsed.data.content,
          structuredPatch: [],
          originalFile: previous?.content ?? null,
          data: { path: result.path, bytes: result.bytes },
          uiFiles: { [result.path]: { code: parsed.data.content } },
        };
      },
    },
    {
      name: "Edit",
      description:
        "替换文件中的指定文本（优先用于修改已有文件，避免整文件重写）。请先 Read 确认上下文后再替换；保持单次替换聚焦，跨关注点改动拆分为多次调用。",
      parameters: toJsonSchema(replaceInFileSchema),
      run: async (input) => {
        const parsed = safeParse<{
          file_path: string;
          old_string: string;
          new_string: string;
          replace_all?: boolean;
        }>(
          replaceInFileSchema,
          input,
          "Edit"
        );
        if (!parsed.ok) throw new Error(parsed.error);
        await workspaceManager.hydrate(token);
        const targetPath = ensureAbsoluteFilePath(parsed.data.file_path, "file_path");
        const oldString = parsed.data.old_string;
        const newString = parsed.data.new_string;
        const replaceAll = parsed.data.replace_all ?? false;
        const existing = await workspaceManager.readFile(token, targetPath);
        if (!existing) {
          return {
            ok: false,
            action: "replace",
            message: `未找到文件 ${targetPath}`,
          };
        }
        const snapshot = getReadSnapshot(readSnapshots, existing.path);
        if (!snapshot) {
          return {
            ok: false,
            action: "replace",
            message: "File has not been read yet. Read it first before editing it.",
          };
        }
        if (snapshot.isPartial) {
          return {
            ok: false,
            action: "replace",
            message: "File was read partially. Read the full file before editing it.",
          };
        }
        const originalFile = String(existing.content || "");
        if (snapshot.content !== originalFile) {
          return {
            ok: false,
            action: "replace",
            message: "File has been modified since read. Read it again before attempting to edit it.",
          };
        }
        const occurrences = oldString ? originalFile.split(oldString).length - 1 : 0;
        if (!oldString || occurrences === 0) {
          return {
            ok: false,
            action: "replace",
            message: `String to replace not found in file.\nString: ${oldString}`,
          };
        }
        if (occurrences > 1 && !replaceAll) {
          return {
            ok: false,
            action: "replace",
            message:
              `Found ${occurrences} matches of the string to replace, but replace_all is false. ` +
              "To replace all occurrences, set replace_all to true. To replace only one occurrence, provide more context.",
          };
        }
        const next = replaceAll
          ? { content: originalFile.split(oldString).join(newString), replaced: occurrences }
          : replaceAtMostOnce(originalFile, oldString, newString);
        const writeResult = await workspaceManager.writeFile(token, existing.path, next.content);
        const latest = await workspaceManager.readFile(token, writeResult.path);
        markReadSnapshot(readSnapshots, {
          filePath: writeResult.path,
          content: next.content,
          isPartial: false,
        });
        changeTracker.paths.add(writeResult.path);
        changeTracker.changed = true;
        return {
          ok: true,
          action: "replace",
          message: `已在 ${writeResult.path} 中替换 ${next.replaced} 处。`,
          filePath: writeResult.path,
          originalFile,
          structuredPatch: [],
          userModified: false,
          replaceAll,
          data: { path: writeResult.path, replaced: next.replaced, bytes: writeResult.bytes },
          uiFiles: latest ? { [writeResult.path]: { code: latest.content } } : {},
        };
      },
    },
    {
      name: "Delete",
      description: "删除指定文件（Claude Delete：仅支持 file_path）。",
      parameters: toJsonSchema(deleteFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ file_path: string }>(deleteFileSchema, input, "Delete");
        if (!parsed.ok) throw new Error(parsed.error);
        await workspaceManager.hydrate(token);
        const targetPath = ensureAbsoluteFilePath(parsed.data.file_path, "file_path");
        const result = await workspaceManager.deleteFile(token, targetPath);
        if (!result.ok) {
          return {
            ok: false,
            action: "delete",
            message: result.message,
          };
        }
        changeTracker.paths.add(result.path);
        changeTracker.changed = true;
        clearReadSnapshot(readSnapshots, result.path);
        return {
          ok: true,
          action: "delete",
          message: `已删除 ${result.path}。`,
          type: "delete",
          filePath: result.path,
          originalFile: result.originalFile,
          data: { path: result.path },
        };
      },
    },
    {
      name: "Grep",
      description: "在项目中按 rg 风格搜索（支持正则、大小写、glob 过滤、上下文）。",
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
        await workspaceManager.hydrate(token);
        if (typeof parsed.data.path === "string" && parsed.data.path.trim()) {
          ensureAbsoluteFilePath(parsed.data.path, "path");
        }
        const outputMode = parsed.data.output_mode || "files_with_matches";
        const includeGlobs: string[] = [];
        const root = normalizeSearchRoot(parsed.data.path);
        if (root) {
          includeGlobs.push(root, `${root}/**`);
        }
        includeGlobs.push(...splitGlobPatterns(parsed.data.glob));

        const contextFromFlags =
          typeof parsed.data["-C"] === "number"
            ? parsed.data["-C"]
            : typeof parsed.data.context === "number"
            ? parsed.data.context
            : Math.max(parsed.data["-A"] || 0, parsed.data["-B"] || 0);
        const headLimit =
          typeof parsed.data.head_limit === "number"
            ? parsed.data.head_limit
            : 250;
        const maxResults = headLimit <= 0 ? 500 : Math.min(Math.max(1, Math.floor(headLimit)), 500);
        const offset = Math.max(0, Math.floor(parsed.data.offset || 0));
        const searchResult = await workspaceManager.searchInFiles(token, {
          query: parsed.data.pattern,
          regex: true,
          caseSensitive: parsed.data["-i"] ? false : true,
          wholeWord: false,
          includeGlobs: includeGlobs.length > 0 ? includeGlobs : undefined,
          excludeGlobs: undefined,
          contextLines: Math.min(5, Math.max(0, Math.floor(contextFromFlags || 0))),
          maxResults,
        });
        const rawResults = (searchResult as any)?.data?.results || [];
        const slicedResults = rawResults.slice(offset);
        const filenames = slicedResults.map((item: any) => item.path);

        if (outputMode === "count") {
          const content = slicedResults
            .map((item: any) => `${item.path}:${Array.isArray(item.matches) ? item.matches.length : 0}`)
            .join("\n");
          return {
            mode: "count",
            numFiles: filenames.length,
            filenames,
            numMatches: slicedResults.reduce(
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
          const content = slicedResults
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
