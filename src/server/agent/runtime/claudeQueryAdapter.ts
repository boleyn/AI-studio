import type { ChatCompletionMessageParam } from "@aistudio/ai/compat/global/core/ai/type";
import type { SdkMessage } from "@shared/chat/sdkMessages";
import { createSdkMessage, sdkContentToText } from "@shared/chat/sdkMessages";
import type { SdkStreamEventName } from "@shared/network/sdkStreamEvents";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { FsOperations } from "../utils/fsOperations";
import { runWithFsImplementation, runWithVirtualProjectRoot } from "../utils/fsOperations";
import { prepareAgentSandboxWorkspace } from "./agentSandboxWorkspace";
import { runWithClaudeConfigHomeDir } from "../utils/envUtils";
import type { RuntimeStrategy } from "./runtimeStrategy";
import { runQueryEngineShadowProbe } from "./queryEngineShadowProbe";
import { AGENT_TOOL_NAME, LEGACY_AGENT_TOOL_NAME } from "../../builtin-tools/tools/AgentTool/constants";
import { registerPendingConversationInteraction } from "@server/chat/activeRuns";
import { getContextWindowForModel } from "../utils/context";

type RunClaudeQueryAdapterInput = {
  token: string;
  chatId: string;
  selectedModel: string;
  selectedSkills: string[];
  historyMessages?: unknown;
  projectFiles?: Record<string, { code?: string }>;
  permissionMode?: unknown;
  messages: ChatCompletionMessageParam[];
  abortSignal?: AbortSignal;
  onEvent: (event: SdkStreamEventName, data: Record<string, unknown>) => void;
  runtimeStrategy: RuntimeStrategy;
};

type RunClaudeQueryAdapterResult = {
  assistantMessage: SdkMessage;
  updatedFiles?: Record<string, { code: string }>;
};

type QueryEngineExecutionAttempt = {
  ok: boolean;
  assistantText?: string;
  assistantMessagePayload?: {
    role?: "user" | "assistant" | "system" | "tool";
    content?: unknown;
    [key: string]: unknown;
  };
  pendingInteraction?: boolean;
  updatedFiles?: Record<string, { code: string }>;
  stopReason?: string | null;
  warnings?: string[];
  resultSubtype?: string | null;
  usage?: {
    input_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  } | null;
  error?: string;
};

type UsagePayload = NonNullable<QueryEngineExecutionAttempt["usage"]>;

type TokenBudgetPayload = {
  used: number;
  total: number;
  percentage: number;
  model: string;
  usedTokens: number;
  maxContext: number;
  remainingTokens: number;
  usedPercent: number;
};

type ToolInputState = {
  id: string;
  index: number;
  name: string;
  inputBuffer: string;
  lastInput?: unknown;
  parentAgentToolUseId?: string;
};

type PendingInteractionDecision = {
  decision: "approve" | "reject";
  answers?: Record<string, string>;
  note?: string;
  updatedInput?: unknown;
};

type ProjectFilesInput = Record<string, { code?: string }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const toUsagePayload = (usage: unknown): UsagePayload | null => {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const record = usage as Record<string, unknown>;
  if (typeof record.input_tokens !== "number" || !Number.isFinite(record.input_tokens)) {
    return null;
  }
  return {
    input_tokens: record.input_tokens,
    cache_creation_input_tokens:
      typeof record.cache_creation_input_tokens === "number" &&
      Number.isFinite(record.cache_creation_input_tokens)
        ? record.cache_creation_input_tokens
        : 0,
    cache_read_input_tokens:
      typeof record.cache_read_input_tokens === "number" &&
      Number.isFinite(record.cache_read_input_tokens)
        ? record.cache_read_input_tokens
        : 0,
    output_tokens:
      typeof record.output_tokens === "number" && Number.isFinite(record.output_tokens)
        ? record.output_tokens
        : 0,
  };
};

const toTokenBudgetFromUsage = ({
  usage,
  model,
}: {
  usage: unknown;
  model: string;
}): TokenBudgetPayload | null => {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const record = usage as Record<string, unknown>;
  const inputTokens = record.input_tokens;
  if (typeof inputTokens !== "number" || !Number.isFinite(inputTokens)) return null;
  const cacheCreationInputTokens =
    typeof record.cache_creation_input_tokens === "number" &&
    Number.isFinite(record.cache_creation_input_tokens)
      ? record.cache_creation_input_tokens
      : 0;
  const cacheReadInputTokens =
    typeof record.cache_read_input_tokens === "number" &&
    Number.isFinite(record.cache_read_input_tokens)
      ? record.cache_read_input_tokens
      : 0;
  const outputTokens =
    typeof record.output_tokens === "number" &&
    Number.isFinite(record.output_tokens)
      ? record.output_tokens
      : 0;
  // Match Claude Code's getTokenCountFromUsage: the full context window size
  // is input_tokens + cache_creation + cache_read + output_tokens.
  // The previous implementation only counted input + cache_creation, which
  // underestimated context usage by 30-50% and prevented autocompact from
  // ever triggering.
  const usedTokens = Math.max(0, Math.floor(
    inputTokens + cacheCreationInputTokens + cacheReadInputTokens + outputTokens
  ));
  const maxContext = Math.max(1, getContextWindowForModel(model));
  const usedPercent = Math.max(0, Math.min(100, (usedTokens / maxContext) * 100));
  return {
    used: usedTokens,
    total: maxContext,
    percentage: usedPercent,
    model,
    usedTokens,
    maxContext,
    remainingTokens: Math.max(0, maxContext - usedTokens),
    usedPercent,
  };
};

const getAgentStartPayload = (toolUseId: string, input: unknown) => {
  if (!isRecord(input)) return null;
  const rawAgentType = typeof input.subagent_type === "string" ? input.subagent_type.trim() : "";
  const rawDescription = typeof input.description === "string" ? input.description.trim() : "";
  const rawPrompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!rawAgentType && !rawDescription && !rawPrompt) return null;
  return {
    subtype: "agent_start",
    id: toolUseId,
    ...(rawAgentType ? { agent_type: rawAgentType } : {}),
    ...(rawDescription ? { description: rawDescription } : {}),
    ...(rawPrompt ? { prompt: rawPrompt } : {}),
  };
};

const getParentAgentToolUseId = (event: unknown): string | undefined => {
  if (!event || typeof event !== "object" || Array.isArray(event)) return undefined;
  const parentToolUseId =
    "parent_tool_use_id" in event && typeof (event as { parent_tool_use_id?: unknown }).parent_tool_use_id === "string"
      ? (event as { parent_tool_use_id: string }).parent_tool_use_id.trim()
      : "";
  return parentToolUseId || undefined;
};

const toVirtualDisplayFilePath = (virtualRoot: string, absolutePath: string): string => {
  const normalizedRoot = path.resolve(virtualRoot);
  const normalizedPath = path.resolve(absolutePath);
  if (normalizedPath === normalizedRoot) return "/";
  if (!normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)) return absolutePath;
  const rel = path.relative(normalizedRoot, normalizedPath).replace(/\\/g, "/");
  return rel ? `/${rel}` : "/";
};

const resolveVirtualToolFilePath = (virtualRoot: string, filePath: string): string => {
  const normalized = filePath.replace(/\\/g, "/").trim();
  if (!normalized) return virtualRoot;
  if (path.isAbsolute(normalized)) {
    return path.resolve(virtualRoot, `.${normalized}`);
  }
  return path.resolve(virtualRoot, normalized);
};

const normalizeProjectFilePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, "/").trim();
  if (!normalized) return "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

const isExportableRuntimeProjectPath = (filePath: string): boolean => {
  const normalized = normalizeProjectFilePath(filePath);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment.startsWith("."))) return false;
  return true;
};

const diffProjectFiles = (
  before: ProjectFilesInput | undefined,
  after: Record<string, { code: string }>,
  ignoredBaseline?: ProjectFilesInput
): Record<string, { code: string }> => {
  const beforeMap = new Map<string, string>();
  for (const [rawPath, file] of Object.entries(before || {})) {
    const normalizedPath = normalizeProjectFilePath(rawPath);
    beforeMap.set(normalizedPath, typeof file?.code === "string" ? file.code : "");
  }
  const ignoredMap = new Map<string, string>();
  for (const [rawPath, file] of Object.entries(ignoredBaseline || {})) {
    const normalizedPath = normalizeProjectFilePath(rawPath);
    ignoredMap.set(normalizedPath, typeof file?.code === "string" ? file.code : "");
  }

  const changed: Record<string, { code: string }> = {};
  for (const [rawPath, file] of Object.entries(after)) {
    const normalizedPath = normalizeProjectFilePath(rawPath);
    if (!isExportableRuntimeProjectPath(normalizedPath)) continue;
    const nextCode = file.code;
    if (beforeMap.get(normalizedPath) === nextCode) continue;
    if (!beforeMap.has(normalizedPath) && ignoredMap.get(normalizedPath) === nextCode) continue;
    changed[normalizedPath] = { code: nextCode };
  }
  return changed;
};

const collectSystemSkillFiles = (systemSkillsRoot: string): ProjectFilesInput => {
  const normalizedRoot = path.resolve(systemSkillsRoot);
  if (!existsSync(normalizedRoot)) return {};
  let rootStats;
  try {
    rootStats = statSync(normalizedRoot);
  } catch {
    return {};
  }
  if (!rootStats.isDirectory()) return {};

  const files: ProjectFilesInput = {};
  const walk = (currentDir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(normalizedRoot, fullPath).replace(/\\/g, "/");
      if (!relative || relative.startsWith("..")) continue;
      let code = "";
      try {
        code = readFileSync(fullPath, "utf8");
      } catch {
        continue;
      }
      files[`/skills/${relative}`] = { code };
    }
  };

  walk(normalizedRoot);
  return files;
};


const buildProjectSandboxOverlay = async ({
  baseCwd,
  workspaceIdentity,
  hostProjectRoot,
  projectFiles,
}: {
  baseCwd: string;
  workspaceIdentity: string;
  hostProjectRoot: string;
  projectFiles?: ProjectFilesInput;
}): Promise<{ workspaceRoot: string; scopedFs: FsOperations; persistToS3: () => Promise<void> }> => {
  const prepared = await prepareAgentSandboxWorkspace({
    baseCwd,
    workspaceIdentity,
    hostProjectRoot,
    projectFiles,
  });
  return {
    workspaceRoot: prepared.workspaceRoot,
    scopedFs: prepared.scopedFs,
    persistToS3: prepared.persistToS3,
  };
};

const exportProjectFilesFromFs = (
  fs: FsOperations,
  projectRoot: string
): Record<string, { code: string }> => {
  const files: Record<string, { code: string }> = {};
  const root = path.resolve(projectRoot);

  const walk = (absoluteDir: string) => {
    let entries: ReturnType<FsOperations["readdirSync"]>;
    try {
      entries = fs.readdirSync(absoluteDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(absoluteDir, entry.name);
      const relativePath = `/${path.relative(root, absolutePath).replace(/\\/g, "/")}`;
      if (!isExportableRuntimeProjectPath(relativePath)) continue;
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        files[normalizeProjectFilePath(relativePath)] = {
          code: fs.readFileSync(absolutePath, { encoding: "utf8" }),
        };
      } catch {
      }
    }
  };

  walk(root);
  return files;
};

const pickNamedExport = <T = unknown>(mod: unknown, key: string): T | undefined => {
  if (!mod || typeof mod !== "object") return undefined;
  const record = mod as Record<string, unknown>;
  if (key in record) return record[key] as T;
  const wrapped =
    (record.default && typeof record.default === "object" ? (record.default as Record<string, unknown>) : null) ??
    (record["module.exports"] && typeof record["module.exports"] === "object"
      ? (record["module.exports"] as Record<string, unknown>)
      : null);
  if (!wrapped) return undefined;
  return wrapped[key] as T | undefined;
};

const ensureClaudeRuntimeGlobals = (): void => {
  const g = globalThis as unknown as {
    MACRO?: {
      VERSION?: string;
      BUILD_TIME?: string;
      FEEDBACK_CHANNEL?: string;
      ISSUES_EXPLAINER?: string;
      NATIVE_PACKAGE_URL?: string;
      PACKAGE_URL?: string;
      VERSION_CHANGELOG?: string;
    };
  };
  if (!g.MACRO) {
    g.MACRO = {
      VERSION: process.env.CLAUDE_CODE_VERSION || "2.1.888",
      BUILD_TIME: new Date().toISOString(),
      FEEDBACK_CHANNEL: "",
      ISSUES_EXPLAINER: "",
      NATIVE_PACKAGE_URL: "",
      PACKAGE_URL: "",
      VERSION_CHANGELOG: "",
    };
  }
};

const ensureClaudeProviderEnv = (input: RunClaudeQueryAdapterInput): void => {
  const aiproxyEndpoint =
    typeof process.env.AIPROXY_API_ENDPOINT === "string" ? process.env.AIPROXY_API_ENDPOINT.trim() : "";
  const aiproxyToken =
    (typeof process.env.AIPROXY_API_TOKEN === "string" && process.env.AIPROXY_API_TOKEN.trim()) ||
    (typeof process.env.CHAT_API_KEY === "string" && process.env.CHAT_API_KEY.trim()) ||
    "";
  if (!aiproxyEndpoint || !aiproxyToken) return;

  // In AIStudio we always prefer AIPROXY when available.
  // Force Claude runtime into OpenAI-compatible provider to avoid drifting
  // into first-party /login flow because of unrelated ANTHROPIC_* env residue.
  process.env.CLAUDE_CODE_USE_OPENAI = "1";
  process.env.OPENAI_BASE_URL = `${aiproxyEndpoint.replace(/\/$/, "")}/v1`;
  process.env.OPENAI_API_KEY = aiproxyToken;

  const selectedModel = (input.selectedModel || "").trim();
  if (selectedModel && !process.env.OPENAI_MODEL) {
    process.env.OPENAI_MODEL = selectedModel;
  }

};

const extractPrompt = (messages: ChatCompletionMessageParam[]): string => {
  const userMessages = messages.filter((item) => item.role === "user");
  const last = userMessages[userMessages.length - 1];
  if (!last) return "";
  const content = (last as { content?: unknown }).content;
  return typeof content === "string" ? content : sdkContentToText(content);
};

const normalizeMessageContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return sdkContentToText(content);
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      parts.push(block.text.trim());
      continue;
    }
    if (block.type === "attachment") {
      const name = typeof block.name === "string" ? block.name.trim() : "";
      const storagePath = typeof block.storage_path === "string" ? block.storage_path.trim() : "";
      const mime = typeof block.mime_type === "string" ? block.mime_type.trim() : "";
      if (name || storagePath) {
        parts.push(
          `[attachment] name=${name || "file"} path=${storagePath || "unknown"}${mime ? ` mime=${mime}` : ""}`
        );
      }
      continue;
    }
  }
  const merged = parts.join("\n");
  return merged || sdkContentToText(content);
};

const getRawMessagesArray = (historyMessages: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(historyMessages)) return [];
  return historyMessages.filter(
    (item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))
  );
};

const getSdkLikeBlocksFromRawMessage = (message: Record<string, unknown>): Array<Record<string, unknown>> => {
  const directMessage =
    message.message && typeof message.message === "object" && !Array.isArray(message.message)
      ? (message.message as Record<string, unknown>)
      : null;
  const directContent = Array.isArray(directMessage?.content) ? (directMessage?.content as unknown[]) : [];

  const kwargs =
    message.additional_kwargs && typeof message.additional_kwargs === "object" && !Array.isArray(message.additional_kwargs)
      ? (message.additional_kwargs as Record<string, unknown>)
      : null;
  const sdkMessage =
    kwargs?.sdkMessage && typeof kwargs.sdkMessage === "object" && !Array.isArray(kwargs.sdkMessage)
      ? (kwargs.sdkMessage as Record<string, unknown>)
      : null;
  const sdkPayload =
    sdkMessage?.message && typeof sdkMessage.message === "object" && !Array.isArray(sdkMessage.message)
      ? (sdkMessage.message as Record<string, unknown>)
      : null;
  const sdkContent = Array.isArray(sdkPayload?.content) ? (sdkPayload?.content as unknown[]) : [];

  const merged = [...directContent, ...sdkContent];
  return merged.filter(
    (item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))
  );
};

const buildToolUseIdIndex = (historyMessages: unknown): Map<string, string> => {
  const index = new Map<string, string>();
  for (const message of getRawMessagesArray(historyMessages)) {
    for (const block of getSdkLikeBlocksFromRawMessage(message)) {
      if (block.type !== "tool_use") continue;
      const id = typeof block.id === "string" ? block.id.trim() : "";
      const name = typeof block.name === "string" ? block.name.trim().toLowerCase() : "";
      if (!id || !name) continue;
      index.set(name, id);
    }
  }
  return index;
};

const buildToolResultMessage = (
  toolUseId: string,
  content: string,
  timestamp: string,
  isError = false
): Record<string, unknown> => ({
  type: "user",
  uuid: randomUUID(),
  timestamp,
  message: {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: toolUseId,
        content,
        ...(isError ? { is_error: true } : {}),
      },
    ],
  },
});

const toInteractionToolResultMessages = (historyMessages: unknown): Array<Record<string, unknown>> => {
  const rawMessages = getRawMessagesArray(historyMessages);
  if (rawMessages.length === 0) return [];
  const toolUseIdByName = buildToolUseIdIndex(historyMessages);
  const toolResultMessages: Array<Record<string, unknown>> = [];
  const emittedInteractionKeys = new Set<string>();

  for (const message of rawMessages) {
    const kwargs =
      message.additional_kwargs && typeof message.additional_kwargs === "object" && !Array.isArray(message.additional_kwargs)
        ? (message.additional_kwargs as Record<string, unknown>)
        : null;
    if (!kwargs) continue;
    const timestamp = typeof message.time === "string" ? message.time : new Date().toISOString();

    const planQuestionResponse =
      kwargs.planQuestionResponse &&
      typeof kwargs.planQuestionResponse === "object" &&
      !Array.isArray(kwargs.planQuestionResponse)
        ? (kwargs.planQuestionResponse as Record<string, unknown>)
        : null;
    if (planQuestionResponse) {
      const requestId =
        typeof planQuestionResponse.requestId === "string" ? planQuestionResponse.requestId.trim() : "";
      const answersObj =
        planQuestionResponse.answers &&
        typeof planQuestionResponse.answers === "object" &&
        !Array.isArray(planQuestionResponse.answers)
          ? (planQuestionResponse.answers as Record<string, unknown>)
          : {};
      const answerText = Object.entries(answersObj)
        .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
        .map(([key, value]) => `"${key}"="${String(value).trim()}"`)
        .join(", ");
      if (requestId && answerText) {
        const dedupeKey = `plan_question:${requestId}:${answerText}`;
        if (emittedInteractionKeys.has(dedupeKey)) continue;
        emittedInteractionKeys.add(dedupeKey);
        toolResultMessages.push(
          buildToolResultMessage(
            requestId,
            `User has answered your questions: ${answerText}. You can now continue with the user's answers in mind.`,
            timestamp
          )
        );
      }
    }

    const planModeApprovalResponse =
      kwargs.planModeApprovalResponse &&
      typeof kwargs.planModeApprovalResponse === "object" &&
      !Array.isArray(kwargs.planModeApprovalResponse)
        ? (kwargs.planModeApprovalResponse as Record<string, unknown>)
        : null;
    if (planModeApprovalResponse) {
      const requestId =
        typeof planModeApprovalResponse.requestId === "string" ? planModeApprovalResponse.requestId.trim() : "";
      const decision = planModeApprovalResponse.decision === "reject" ? "reject" : "approve";
      const action = planModeApprovalResponse.action === "enter" ? "enter" : "exit";
      if (requestId) {
        const dedupeKey = `plan_mode_approval:${requestId}:${action}:${decision}`;
        if (emittedInteractionKeys.has(dedupeKey)) continue;
        emittedInteractionKeys.add(dedupeKey);
        const content = (() => {
          if (decision === "approve") {
            if (action === "exit") {
              return "User has approved your plan. You can now start coding.";
            }
            return "User approved entering plan mode. Continue accordingly.";
          }
          if (action === "exit") {
            return "User rejected exiting plan mode. Refine your plan and ask again.";
          }
          return "User rejected entering plan mode. Continue without plan mode.";
        })();
        toolResultMessages.push(buildToolResultMessage(requestId, content, timestamp, decision === "reject"));
      }
    }

    const permissionApprovalResponse =
      kwargs.permissionApprovalResponse &&
      typeof kwargs.permissionApprovalResponse === "object" &&
      !Array.isArray(kwargs.permissionApprovalResponse)
        ? (kwargs.permissionApprovalResponse as Record<string, unknown>)
        : null;
    if (permissionApprovalResponse) {
      const explicitToolUseId =
        typeof permissionApprovalResponse.toolUseId === "string" && permissionApprovalResponse.toolUseId.trim()
          ? permissionApprovalResponse.toolUseId.trim()
          : typeof permissionApprovalResponse.requestId === "string" && permissionApprovalResponse.requestId.trim()
          ? permissionApprovalResponse.requestId.trim()
          : "";
      const toolName =
        typeof permissionApprovalResponse.toolName === "string"
          ? permissionApprovalResponse.toolName.trim().toLowerCase()
          : "";
      const decision = permissionApprovalResponse.decision === "reject" ? "reject" : "approve";
      const toolUseId = explicitToolUseId || (toolName ? toolUseIdByName.get(toolName) : undefined);
      if (toolUseId) {
        const dedupeKey = `permission:${toolUseId}:${decision}`;
        if (emittedInteractionKeys.has(dedupeKey)) continue;
        emittedInteractionKeys.add(dedupeKey);
        const content =
          decision === "approve"
            ? `User approved tool permission${toolName ? ` for ${toolName}` : ""}.`
            : `User rejected tool permission${toolName ? ` for ${toolName}` : ""}.`;
        toolResultMessages.push(buildToolResultMessage(toolUseId, content, timestamp, decision === "reject"));
      }
    }
  }

  return toolResultMessages;
};

const toQueryEngineHistory = (messages: ChatCompletionMessageParam[]): unknown[] => {
  if (messages.length === 0) return [];
  const history = messages.slice(0, -1);
  const result: unknown[] = [];
  for (const entry of history) {
    if (!entry || typeof entry !== "object") continue;
    const role = (entry as { role?: string }).role;
    if (role !== "user" && role !== "assistant") continue;
    const content = normalizeMessageContent((entry as { content?: unknown }).content);
    if (!content.trim()) continue;
    result.push({
      type: role,
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      message: {
        role,
        content,
      },
    });
  }
  return result;
};

const toSdkLikeHistory = (messages: ChatCompletionMessageParam[]): SdkMessage[] => {
  const history = messages.slice(0, -1);
  const output: SdkMessage[] = [];
  for (const entry of history) {
    if (!entry || typeof entry !== "object") continue;
    const role = (entry as { role?: string }).role;
    if (role !== "user" && role !== "assistant") continue;
    const content = normalizeMessageContent((entry as { content?: unknown }).content).trim();
    if (!content) continue;
    output.push(
      createSdkMessage({
        type: role,
        message: {
          role,
          content,
        },
      })
    );
  }
  return output;
};

const toQueryEngineHistoryWithClaudeMapper = async (
  messages: ChatCompletionMessageParam[]
): Promise<unknown[]> => {
  try {
    const mapperMod = await import("../utils/messages/mappers");
    const toInternalMessages = pickNamedExport<((items: SdkMessage[]) => unknown[])>(mapperMod, "toInternalMessages");
    if (typeof toInternalMessages !== "function") {
      return toQueryEngineHistory(messages);
    }
    const converted = toInternalMessages(toSdkLikeHistory(messages));
    if (!Array.isArray(converted)) return toQueryEngineHistory(messages);
    return converted;
  } catch {
    return toQueryEngineHistory(messages);
  }
};

const buildAppendSystemPrompt = (input: RunClaudeQueryAdapterInput): string | undefined => {
  const parts: string[] = [];
  parts.push(
    [
      "Environment: VIRTUAL SANDBOX (not host machine).",
      "For frontend preview/compile, MUST use compile_project in Sandpack. NEVER start dev servers via CLI.",
    ].join("\n")
  );
  const systemMessages = input.messages
    .filter((item) => item.role === "system")
    .map((item) => normalizeMessageContent((item as { content?: unknown }).content).trim())
    .filter(Boolean);
  if (systemMessages.length > 0) {
    parts.push(`System directives:\n${systemMessages.join("\n\n")}`);
  }
  if (input.selectedSkills.length > 0) {
    parts.push(`Selected runtime skills: ${input.selectedSkills.join(", ")}`);
  }
  if (input.projectFiles && Object.keys(input.projectFiles).length > 0) {
    const fileNames = Object.keys(input.projectFiles).slice(0, 80);
    parts.push(`Project files in scope (${fileNames.length}):\n${fileNames.join("\n")}`);
  }
  const merged = parts.join("\n\n").trim();
  return merged || undefined;
};

const parseJsonLoose = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
};

const summarizeToolResultContentForStream = ({
  toolName,
  content,
}: {
  toolName?: string;
  content: unknown;
}): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "", null, 2);

  const imageBlocks = content
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .filter((item) => item.type === "image");

  if (imageBlocks.length > 0) {
    const normalizedTool = (toolName || "").trim().toLowerCase();
    const label = normalizedTool === "read" ? "Read image result" : "Image tool result";
    const parts = imageBlocks.slice(0, 4).map((block, index) => {
      const source =
        block.source && typeof block.source === "object" && !Array.isArray(block.source)
          ? (block.source as Record<string, unknown>)
          : null;
      const mediaType = typeof source?.media_type === "string" ? source.media_type : "image";
      const base64 = typeof source?.data === "string" ? source.data : "";
      const bytes = base64 ? Math.max(0, Math.floor((base64.length * 3) / 4)) : 0;
      const size = bytes > 0 ? ` ~${Math.round(bytes / 1024)}KB` : "";
      return `image${index + 1}: ${mediaType}${size}`;
    });
    const extra = imageBlocks.length > 4 ? ` (+${imageBlocks.length - 4} more)` : "";
    return `[${label}] ${parts.join("; ")}${extra}`;
  }

  return JSON.stringify(content, null, 2);
};

const normalizePlanQuestionPayload = (toolInput: unknown): { questions: Array<Record<string, unknown>> } | null => {
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) return null;
  const input = toolInput as Record<string, unknown>;
  const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
  const questions = rawQuestions
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item, index) => {
      const optionsRaw = Array.isArray(item.options) ? item.options : [];
      const options = optionsRaw
        .filter((opt): opt is Record<string, unknown> => Boolean(opt && typeof opt === "object" && !Array.isArray(opt)))
        .map((opt) => ({
          label: typeof opt.label === "string" ? opt.label : "",
          ...(typeof opt.description === "string" ? { description: opt.description } : {}),
        }))
        .filter((opt) => opt.label.trim().length > 0);
      const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `q_${index + 1}`;
      const question = typeof item.question === "string" ? item.question : "";
      return {
        id,
        question,
        ...(typeof item.header === "string" && item.header.trim() ? { header: item.header.trim() } : {}),
        ...(options.length > 0 ? { options } : {}),
      };
    })
    .filter((item) => item.question.trim().length > 0);
  if (questions.length === 0) return null;
  return { questions };
};

const normalizePlanProgressPayload = (
  toolInput: unknown
): { explanation?: string; plan: Array<{ step: string; status: "pending" | "in_progress" | "completed" }> } | null => {
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) return null;
  const input = toolInput as Record<string, unknown>;
  const planRaw = Array.isArray(input.plan) ? input.plan : [];
  const plan = planRaw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item) => {
      const status: "pending" | "in_progress" | "completed" =
        item.status === "completed" ? "completed" : item.status === "in_progress" ? "in_progress" : "pending";
      return {
        step: typeof item.step === "string" ? item.step.trim() : "",
        status,
      };
    })
    .filter((item) => item.step.length > 0);
  if (plan.length === 0) return null;
  return {
    ...(typeof input.explanation === "string" && input.explanation.trim() ? { explanation: input.explanation.trim() } : {}),
    plan,
  };
};

const normalizePlanApprovalPayload = (toolInput: unknown): { action: "enter" | "exit"; title?: string; description?: string } => {
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return {
      action: "exit",
      title: "计划已完成，是否进入执行？",
    };
  }
  const input = toolInput as Record<string, unknown>;
  const plan = typeof input.plan === "string" ? input.plan.trim() : "";
  return {
    action: "exit",
    title: "计划已完成，是否进入执行？",
    ...(plan ? { description: plan.slice(0, 1200) } : {}),
  };
};

const emitPlanControlEventFromTool = (
  input: RunClaudeQueryAdapterInput,
  toolState: ToolInputState,
  emittedControlKeys: Set<string>
): boolean => {
  const toolName = toolState.name.trim().toLowerCase();
  if (!toolState.id) return false;
  if (toolName === "askuserquestion" || toolName === "request_user_input" || toolName === "requestuserinput") {
    const payload = normalizePlanQuestionPayload(toolState.lastInput);
    if (!payload) return false;
    const dedupeKey = `${toolState.id}:plan_question`;
    if (emittedControlKeys.has(dedupeKey)) return false;
    emittedControlKeys.add(dedupeKey);
    input.onEvent("control", {
      interaction: {
        type: "plan_question",
        requestId: toolState.id,
        payload,
      },
    });
    return true;
  }
  if (toolName === "exitplanmode" || toolName === "exit_plan_mode" || toolName === "exitplanmodev2") {
    const payload = normalizePlanApprovalPayload(toolState.lastInput);
    const dedupeKey = `${toolState.id}:plan_approval`;
    if (emittedControlKeys.has(dedupeKey)) return false;
    emittedControlKeys.add(dedupeKey);
    input.onEvent("control", {
      interaction: {
        type: "plan_approval",
        requestId: toolState.id,
        payload,
      },
    });
    return true;
  }
  if (toolName === "update_plan") {
    const payload = normalizePlanProgressPayload(toolState.lastInput);
    if (!payload) return false;
    const dedupeKey = `${toolState.id}:plan_progress`;
    if (emittedControlKeys.has(dedupeKey)) return false;
    emittedControlKeys.add(dedupeKey);
    input.onEvent("control", {
      interaction: {
        type: "plan_progress",
        requestId: toolState.id,
        payload,
      },
    });
    return false;
  }
  return false;
};

const waitForPendingInteractionDecision = ({
  input,
  toolState,
  kind,
  signal,
}: {
  input: RunClaudeQueryAdapterInput;
  toolState: ToolInputState;
  kind: "plan_question" | "plan_approval" | "permission";
  signal?: AbortSignal;
}): Promise<PendingInteractionDecision | null> => {
  if (!toolState.id) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finalize = (decision: PendingInteractionDecision | null) => {
      if (settled) return;
      settled = true;
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
      resolve(decision);
    };
    const abortHandler = () => finalize(null);
    if (signal) {
      if (signal.aborted) {
        finalize(null);
        return;
      }
      signal.addEventListener("abort", abortHandler, { once: true });
    }
    const registered = registerPendingConversationInteraction({
      token: input.token,
      chatId: input.chatId,
      requestId: toolState.id,
      interaction: {
        kind,
        toolName: toolState.name,
        toolUseId: toolState.id,
        input: toolState.lastInput,
      },
      resolve: finalize,
    });
    if (!registered) finalize(null);
  });
};

const getInteractionKindForToolName = (
  toolName: string
): "plan_question" | "plan_approval" | "permission" | null => {
  const normalized = toolName.trim().toLowerCase();
  if (
    normalized === "askuserquestion" ||
    normalized === "request_user_input" ||
    normalized === "requestuserinput"
  ) {
    return "plan_question";
  }
  if (
    normalized === "exitplanmode" ||
    normalized === "exit_plan_mode" ||
    normalized === "exitplanmodev2"
  ) {
    return "plan_approval";
  }
  return null;
};

const tryRunQueryEngine = async (
  input: RunClaudeQueryAdapterInput
): Promise<QueryEngineExecutionAttempt> => {
  ensureClaudeRuntimeGlobals();
  ensureClaudeProviderEnv(input);
  const probe = await runQueryEngineShadowProbe();
  if (!probe.ready) {
    return {
      ok: false,
      warnings: probe.warnings,
      error: `query_engine_not_ready:${probe.reasons.join(",")}`,
    };
  }

  const baseCwd = process.cwd();
  const hasVirtualProjectFiles = Boolean(input.projectFiles && Object.keys(input.projectFiles).length > 0);
  const virtualProjectRoot = path.resolve(baseCwd, ".aistudio", "sandboxes", input.token || "project");
  const systemSkillFiles = collectSystemSkillFiles(path.resolve(process.cwd(), "skills"));
  const sandboxWorkspace = await buildProjectSandboxOverlay({
    baseCwd,
    workspaceIdentity: input.token || "project",
    hostProjectRoot: path.resolve(process.cwd()),
    projectFiles: input.projectFiles,
  });
  const scopedFs = sandboxWorkspace.scopedFs;

  const runCore = async (): Promise<QueryEngineExecutionAttempt> => {
    let assistantText = "";
    let assistantMessagePayload: QueryEngineExecutionAttempt["assistantMessagePayload"] | undefined;
    let pendingInteraction = false;
    let stopReason: string | null = null;
    let resultSubtype: string | null = null;
    let resultUsage: QueryEngineExecutionAttempt["usage"] = null;
    let lastTopLevelAssistantUsage: UsagePayload | null = null;
    try {
      const configMod = await import("../utils/config");
      const enableConfigs = pickNamedExport<() => void>(configMod, "enableConfigs");
      if (enableConfigs) {
        enableConfigs();
      }

      const cwd = virtualProjectRoot;

      const toVirtualDisplayPath = (candidate: string): string => {
        const normalize = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
        const normalizedRoot = normalize(virtualProjectRoot);
        const normalizedCandidate = normalize(candidate);
        if (normalizedCandidate === normalizedRoot) return ".";
        if (!normalizedCandidate.startsWith(`${normalizedRoot}/`)) return candidate;
        const rel = normalizedCandidate.slice(normalizedRoot.length + 1);
        return rel || ".";
      };

      const emitEvent = (event: SdkStreamEventName, data: Record<string, unknown>) => {
        input.onEvent(event, data);
      };
      const selectedModelId =
        typeof input.selectedModel === "string" && input.selectedModel.trim()
          ? input.selectedModel.trim()
          : "agent";
      let lastTokenBudgetFingerprint = "";
      const emitTokenBudgetStatus = (usage: unknown) => {
        const tokenBudget = toTokenBudgetFromUsage({
          usage,
          model: selectedModelId,
        });
        if (!tokenBudget) return;
        const fingerprint = `${tokenBudget.usedTokens}:${tokenBudget.maxContext}:${tokenBudget.usedPercent.toFixed(3)}`;
        if (fingerprint === lastTokenBudgetFingerprint) return;
        lastTokenBudgetFingerprint = fingerprint;
        emitEvent("status", {
          text: "token_budget",
          tokenBudget,
        });
      };
      const [appStateMod, commandsMod, toolsMod, toolMod, permissionMod, queryEngineMod, fileStateCacheMod] =
        await Promise.all([
          import("../state/AppStateStore"),
          import("../commands"),
          import("../tools"),
          import("../Tool"),
          import("../utils/permissions/PermissionMode"),
          import("../QueryEngine"),
          import("../utils/fileStateCache"),
        ]);

    const getDefaultAppState = pickNamedExport<() => any>(appStateMod, "getDefaultAppState");
    const getCommands = pickNamedExport<(cwd: string) => Promise<any[]>>(commandsMod, "getCommands");
    const getTools = pickNamedExport<(ctx: unknown) => any>(toolsMod, "getTools");
    const getEmptyToolPermissionContext = pickNamedExport<() => Record<string, unknown>>(
      toolMod,
      "getEmptyToolPermissionContext"
    );
    const permissionModeFromString = pickNamedExport<(mode: string) => string>(permissionMod, "permissionModeFromString");
    const ask = pickNamedExport<(input: Record<string, unknown>) => AsyncIterable<unknown>>(queryEngineMod, "ask");
    const createFileStateCacheWithSizeLimit = pickNamedExport<(maxEntries: number) => unknown>(
      fileStateCacheMod,
      "createFileStateCacheWithSizeLimit"
    );
    const READ_FILE_STATE_CACHE_SIZE = pickNamedExport<number>(fileStateCacheMod, "READ_FILE_STATE_CACHE_SIZE");

    if (
      !getDefaultAppState ||
      !getCommands ||
      !getTools ||
      !getEmptyToolPermissionContext ||
      !permissionModeFromString ||
      !ask ||
      !createFileStateCacheWithSizeLimit
    ) {
      return {
        ok: false,
        warnings: probe.warnings,
        error: "query_engine_exports_unavailable",
      };
    }

    const resolvedPermissionMode =
      typeof input.permissionMode === "string" ? permissionModeFromString(input.permissionMode) : "default";
    const permissionContext = {
      ...getEmptyToolPermissionContext(),
      mode: resolvedPermissionMode,
    };
    const tools = getTools(permissionContext);
    const commands = await getCommands(cwd);
    let appState = getDefaultAppState();
    appState = {
      ...appState,
      toolPermissionContext: permissionContext,
      mcp: {
        ...appState.mcp,
        tools,
        commands,
      },
      mainLoopModel: input.selectedModel || appState.mainLoopModel,
      mainLoopModelForSession: input.selectedModel || appState.mainLoopModelForSession,
    };

    const getAppState = () => appState;
    const setAppState = (updater: (prev: typeof appState) => typeof appState) => {
      appState = updater(appState);
    };
    let readFileCache: unknown | undefined = undefined;
    const getReadFileCache = () =>
      readFileCache ??
      createFileStateCacheWithSizeLimit(typeof READ_FILE_STATE_CACHE_SIZE === "number" ? READ_FILE_STATE_CACHE_SIZE : 100);
    const setReadFileCache = (cache: unknown) => {
      readFileCache = cache;
    };

    const prompt = extractPrompt(input.messages) || "Please continue.";
    const mutableMessages = [
      ...(await toQueryEngineHistoryWithClaudeMapper(input.messages)),
      ...toInteractionToolResultMessages(input.historyMessages),
    ];
    const appendSystemPrompt = buildAppendSystemPrompt(input);
    const toolStateByIndex = new Map<number, ToolInputState>();
    const toolStateById = new Map<string, ToolInputState>();
    const emittedControlKeys = new Set<string>();
    const emittedAgentStartIds = new Set<string>();
    const emittedToolUseStartIds = new Set<string>();
    const queryAbortController = input.abortSignal
      ? (() => {
          const controller = new AbortController();
          if (input.abortSignal.aborted) controller.abort();
          else {
            input.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
          }
          return controller;
        })()
      : undefined;

    const canUseTool = async (
      tool: { name?: string } | undefined,
      toolInput: unknown,
      _toolUseContext?: unknown,
      _assistantMessage?: unknown,
      toolUseID?: string
    ) => {
      const toolName = typeof tool?.name === "string" && tool.name.trim() ? tool.name.trim() : "unknown_tool";
      const interactionKind = getInteractionKindForToolName(toolName);
      const normalizedToolUseId = typeof toolUseID === "string" ? toolUseID.trim() : "";
      if (!interactionKind || !normalizedToolUseId) {
        return {
          behavior: "allow",
          updatedInput: toolInput,
          ...(normalizedToolUseId ? { toolUseID: normalizedToolUseId } : {}),
        };
      }

      const toolState = toolStateById.get(normalizedToolUseId) || {
        id: normalizedToolUseId,
        name: toolName,
        index: -1,
        inputBuffer: "",
        lastInput: toolInput,
      };
      toolState.lastInput = toolInput;
      toolStateById.set(normalizedToolUseId, toolState);

      if (emitPlanControlEventFromTool(input, toolState, emittedControlKeys)) {
        pendingInteraction = true;
      }

      const decision = await waitForPendingInteractionDecision({
        input,
        toolState,
        kind: interactionKind,
        signal: queryAbortController?.signal,
      });

      if (!decision) {
        return {
          behavior: "deny",
          message: "User interaction was cancelled before a response was received.",
          decisionReason: "user_denied",
          toolUseID: normalizedToolUseId,
        };
      }

      if (decision.decision === "reject") {
        const rejectMessage =
          interactionKind === "plan_question"
            ? decision.note || "User declined to answer the questions."
            : interactionKind === "plan_approval"
            ? decision.note || "User rejected the current plan."
            : decision.note || `User rejected permission for ${toolName}.`;
        return {
          behavior: "deny",
          message: rejectMessage,
          decisionReason: "user_denied",
          toolUseID: normalizedToolUseId,
        };
      }

      return {
        behavior: "allow",
        updatedInput: decision.updatedInput !== undefined ? decision.updatedInput : toolInput,
        toolUseID: normalizedToolUseId,
      };
    };

    const maybeEmitAgentStart = (toolState: ToolInputState) => {
      if (emittedAgentStartIds.has(toolState.id)) return;
      if (toolState.name !== AGENT_TOOL_NAME && toolState.name !== LEGACY_AGENT_TOOL_NAME) return;
      const agentStartPayload = getAgentStartPayload(toolState.id, toolState.lastInput);
      if (!agentStartPayload) return;
      emittedAgentStartIds.add(toolState.id);
      emitEvent("stream_event", agentStartPayload);
    };

    for await (const event of ask({
      commands,
      prompt,
      cwd,
      tools,
      mcpClients: [],
      canUseTool,
      mutableMessages: mutableMessages as any[],
      getReadFileCache,
      setReadFileCache,
      appendSystemPrompt,
      userSpecifiedModel: input.selectedModel,
      fallbackModel: undefined,
      getAppState,
      setAppState,
      abortController: queryAbortController,
      replayUserMessages: false,
      includePartialMessages: true,
    })) {
      if ((event as { type?: string }).type === "stream_event") {
        const stream = event as {
          event?: {
            type?: string;
            index?: number;
            content_block?: { type?: string; id?: string; name?: string; input?: unknown };
            delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
          };
        };
        const streamType = stream.event?.type;
        if (streamType === "content_block_start" && stream.event?.content_block?.type === "tool_use") {
          const id = typeof stream.event.content_block.id === "string" ? stream.event.content_block.id : "";
          const name = typeof stream.event.content_block.name === "string" ? stream.event.content_block.name : "tool";
          const index = typeof stream.event.index === "number" ? stream.event.index : -1;
          const parentAgentToolUseId = getParentAgentToolUseId(event);
          const nextState: ToolInputState = {
            id,
            name,
            index,
            inputBuffer: "",
            lastInput: stream.event.content_block.input,
            ...(parentAgentToolUseId ? { parentAgentToolUseId } : {}),
          };
          if (index >= 0) toolStateByIndex.set(index, nextState);
          if (id) toolStateById.set(id, nextState);
          if (!emittedToolUseStartIds.has(id)) {
            emittedToolUseStartIds.add(id);
            emitEvent("stream_event", {
              subtype: nextState.parentAgentToolUseId ? "agent_tool_use_start" : "tool_use_start",
              id,
              name,
              ...(nextState.lastInput !== undefined ? { input: nextState.lastInput } : {}),
              ...(nextState.parentAgentToolUseId
                ? { parent_agent_tool_use_id: nextState.parentAgentToolUseId }
                : {}),
            });
          }
          maybeEmitAgentStart(nextState);
          continue;
        }
        if (streamType === "content_block_delta") {
          const deltaType = stream.event?.delta?.type;
          if (deltaType === "text_delta" && typeof stream.event?.delta?.text === "string") {
            emitEvent("stream_event", {
              subtype: "text_delta",
              text: stream.event.delta.text,
            });
            continue;
          }
          if (deltaType === "thinking_delta" && typeof stream.event?.delta?.thinking === "string") {
            emitEvent("stream_event", {
              subtype: "thinking_delta",
              text: stream.event.delta.thinking,
            });
            continue;
          }
          if (deltaType === "input_json_delta" && typeof stream.event?.delta?.partial_json === "string") {
            const index = typeof stream.event?.index === "number" ? stream.event.index : -1;
            const state = index >= 0 ? toolStateByIndex.get(index) : undefined;
            if (state) {
              state.inputBuffer += stream.event.delta.partial_json;
              const parsed = parseJsonLoose(state.inputBuffer);
              if (parsed !== undefined) state.lastInput = parsed;
              emitEvent("stream_event", {
                subtype: state.parentAgentToolUseId ? "agent_tool_use_delta" : "tool_use_delta",
                id: state.id,
                name: state.name,
                input: state.lastInput ?? state.inputBuffer,
                ...(state.parentAgentToolUseId
                  ? { parent_agent_tool_use_id: state.parentAgentToolUseId }
                  : {}),
              });
              maybeEmitAgentStart(state);
            }
            continue;
          }
        }
      }
      if ((event as { type?: string }).type === "assistant") {
        const assistant = event as {
          parent_tool_use_id?: unknown;
          message?: { content?: unknown; usage?: unknown };
        };
        const parentAgentToolUseId = getParentAgentToolUseId(event);
        if (!parentAgentToolUseId) {
          const assistantUsage = toUsagePayload(assistant.message?.usage);
          if (assistantUsage) {
            lastTopLevelAssistantUsage = assistantUsage;
            emitTokenBudgetStatus(lastTopLevelAssistantUsage);
          }
        }
        const blocks = Array.isArray(assistant.message?.content) ? assistant.message?.content : [];
        for (const block of blocks) {
          if (!block || typeof block !== "object") continue;
          const record = block as Record<string, unknown>;
          if (record.type !== "tool_use" || typeof record.id !== "string") continue;
          const id = record.id;
          const name = typeof record.name === "string" ? record.name : "tool";
          const lastInput = record.input;
          const nextState: ToolInputState = {
            id,
            name,
            index: -1,
            inputBuffer: "",
            lastInput,
            ...(parentAgentToolUseId ? { parentAgentToolUseId } : {}),
          };
          toolStateById.set(id, nextState);
          if (!emittedToolUseStartIds.has(id)) {
            emittedToolUseStartIds.add(id);
            emitEvent("stream_event", {
              subtype: parentAgentToolUseId ? "agent_tool_use_start" : "tool_use_start",
              id,
              name,
              ...(lastInput !== undefined ? { input: lastInput } : {}),
              ...(parentAgentToolUseId ? { parent_agent_tool_use_id: parentAgentToolUseId } : {}),
            });
          }
        }
      }
      if ((event as { type?: string }).type === "user") {
        const user = event as { message?: { content?: unknown } };
        const parentAgentToolUseIdFromEvent = getParentAgentToolUseId(event);
        const blocks = Array.isArray(user.message?.content) ? user.message?.content : [];
        for (const block of blocks) {
          if (!block || typeof block !== "object") continue;
          const record = block as Record<string, unknown>;
          if (record.type !== "tool_result" || typeof record.tool_use_id !== "string") continue;
          const toolState = toolStateById.get(record.tool_use_id);
          const contentText = summarizeToolResultContentForStream({
            toolName: toolState?.name,
            content: record.content,
          });
          const parentAgentToolUseId = toolState?.parentAgentToolUseId || parentAgentToolUseIdFromEvent;
          emitEvent("stream_event", {
            subtype: parentAgentToolUseId ? "agent_tool_result" : "tool_result",
            id: record.tool_use_id,
            ...(toolState?.name ? { name: toolState.name } : {}),
            ...(toolState?.lastInput !== undefined ? { input: toolState.lastInput } : {}),
            ...(parentAgentToolUseId ? { parent_agent_tool_use_id: parentAgentToolUseId } : {}),
            content: contentText,
            ...(record.is_error === true ? { is_error: true } : {}),
          });

          // In sandbox workspace sessions, FileWrite/FileEdit mutate scoped workspace files.
          // Emit an explicit files_updated event so frontend can reflect latest code immediately.
          if (toolState?.lastInput && (toolState.name === "Write" || toolState.name === "Edit")) {
            const inputPayload = toolState.lastInput as Record<string, unknown>;
            const rawToolPath =
              typeof inputPayload.file_path === "string" ? inputPayload.file_path : "";
            if (rawToolPath) {
              const absoluteFilePath = resolveVirtualToolFilePath(virtualProjectRoot, rawToolPath);
              try {
                const latestCode = scopedFs.readFileSync(absoluteFilePath, { encoding: "utf8" });
                if (typeof latestCode === "string") {
                  const displayPath = toVirtualDisplayFilePath(virtualProjectRoot, absoluteFilePath);
                  if (!isExportableRuntimeProjectPath(displayPath)) {
                    continue;
                  }
                  emitEvent("stream_event", {
                    subtype: "files_updated",
                    files: {
                      [displayPath]: {
                        code: latestCode,
                      },
                    },
                  });
                }
              } catch {
                // Ignore sync read failures; normal tool_result still flows.
              }
            }
          }
        }
      }
      if ((event as { type?: string }).type === "assistant") {
        const msg = event as { message?: { content?: unknown } };
        if (msg.message && typeof msg.message === "object") {
          const payload = msg.message as Record<string, unknown>;
          const content = payload.content;
          const hasStructuredContent =
            (typeof content === "string" && content.trim().length > 0) ||
            (Array.isArray(content) && content.length > 0);
          if (hasStructuredContent) {
            assistantMessagePayload = {
              ...payload,
              role:
                payload.role === "user" ||
                payload.role === "system" ||
                payload.role === "tool"
                  ? payload.role
                  : "assistant",
            };
          }
        }
        const text = sdkContentToText(msg.message?.content);
        if (text.trim()) assistantText = text;
      }
      if ((event as { type?: string }).type === "system") {
        const systemEvent = event as {
          subtype?: unknown;
          compact_metadata?: unknown;
          pre_tokens?: unknown;
          tokens_saved?: unknown;
        };
        const subtype =
          typeof systemEvent.subtype === "string" ? systemEvent.subtype.trim().toLowerCase() : "";
        if (subtype === "compact_boundary") {
          const compactMetadata =
            systemEvent.compact_metadata &&
            typeof systemEvent.compact_metadata === "object" &&
            !Array.isArray(systemEvent.compact_metadata)
              ? (systemEvent.compact_metadata as Record<string, unknown>)
              : {};
          const trigger =
            typeof compactMetadata.trigger === "string" && compactMetadata.trigger.trim()
              ? compactMetadata.trigger.trim()
              : "auto";
          const preTokensRaw = compactMetadata.pre_tokens;
          const preTokens =
            typeof preTokensRaw === "number" && Number.isFinite(preTokensRaw)
              ? Math.max(0, Math.floor(preTokensRaw))
              : undefined;
          emitEvent("stream_event", {
            subtype: "compact_boundary",
            trigger,
            ...(preTokens !== undefined ? { pre_tokens: preTokens } : {}),
          });
          continue;
        }
      }
      if ((event as { type?: string }).type === "result") {
        const result = event as {
          subtype?: string;
          result?: string;
          stop_reason?: string | null;
          usage?: unknown;
        };
        resultSubtype = result.subtype ?? null;
        stopReason = result.stop_reason ?? null;
        const normalizedResultUsage = toUsagePayload(result.usage);
        if (normalizedResultUsage) {
          resultUsage = normalizedResultUsage;
          // result.usage can be cumulative across iterations/background work;
          // prefer the latest top-level assistant usage for context window UI.
          emitTokenBudgetStatus(lastTopLevelAssistantUsage ?? resultUsage);
        }
        if (!assistantText.trim() && typeof result.result === "string" && result.result.trim()) {
          assistantText = result.result;
        }
      }
    }

      if (assistantMessagePayload || assistantText.trim() || pendingInteraction) {
        const finalUsage = lastTopLevelAssistantUsage ?? resultUsage;
        return {
          ok: true,
          assistantText,
          assistantMessagePayload,
          pendingInteraction,
          stopReason,
          resultSubtype,
          usage: finalUsage,
          warnings: probe.warnings,
        };
      }
      return {
        ok: false,
        warnings: probe.warnings,
        stopReason,
        resultSubtype,
        usage: resultUsage,
        error: "query_engine_finished_without_assistant_text",
      };
    } catch (error) {
      if (pendingInteraction) {
        return {
          ok: true,
          assistantText,
          assistantMessagePayload,
          pendingInteraction: true,
          stopReason: stopReason || "pending_interaction",
          resultSubtype,
          usage: resultUsage,
          warnings: probe.warnings,
        };
      }
      if (error instanceof Error) {
        console.error("[query_engine][exception]", {
          message: error.message,
          stack: error.stack,
        });
      } else {
        console.error("[query_engine][exception]", { error: String(error) });
      }
      return {
        ok: false,
        warnings: probe.warnings,
        error: error instanceof Error ? error.message : String(error ?? "query_engine_import_failed"),
      };
    }
  };

  const attachUpdatedFiles = async (attempt: QueryEngineExecutionAttempt): Promise<QueryEngineExecutionAttempt> => {
    await sandboxWorkspace.persistToS3().catch(() => undefined);
    if (!hasVirtualProjectFiles) return attempt;
    const snapshot = exportProjectFilesFromFs(scopedFs, virtualProjectRoot);
    const updatedFiles = diffProjectFiles(input.projectFiles, snapshot, systemSkillFiles);
    if (Object.keys(updatedFiles).length === 0) return attempt;
    input.onEvent("stream_event", {
      subtype: "files_updated",
      files: updatedFiles,
    });
    return {
      ...attempt,
      updatedFiles,
    };
  };

  const attempt = await runWithVirtualProjectRoot(
    virtualProjectRoot,
    () =>
      runWithClaudeConfigHomeDir(path.join(virtualProjectRoot, ".aistudio"), () =>
        runWithFsImplementation(scopedFs, runCore),
      ),
  );
  return await attachUpdatedFiles(attempt);
};

export const runClaudeQueryAdapter = async (
  input: RunClaudeQueryAdapterInput
): Promise<RunClaudeQueryAdapterResult> => {
  if (input.abortSignal?.aborted) {
    throw new Error("请求已取消");
  }

  input.onEvent("status", {
    phase: "runtime_selected",
    strategy: input.runtimeStrategy,
  });

  if (input.runtimeStrategy === "query_engine_shadow") {
    const probe = await runQueryEngineShadowProbe();
    input.onEvent("status", {
      phase: "query_engine_shadow_probe",
      ready: probe.ready,
      reasons: probe.reasons,
      warnings: probe.warnings,
      bunBundleFiles: probe.bunBundleFiles.slice(0, 40),
      bunBundleFileCount: probe.bunBundleFiles.length,
    });
  }

  if (input.runtimeStrategy === "query_engine") {
    const attempt = await tryRunQueryEngine(input);
    input.onEvent("status", {
      phase: "query_engine_attempt",
      ok: attempt.ok,
      pendingInteraction: attempt.pendingInteraction === true,
      permissionMode:
        typeof input.permissionMode === "string" && input.permissionMode.trim() ? input.permissionMode.trim() : "default",
      resultSubtype: attempt.resultSubtype ?? null,
      stopReason: attempt.stopReason ?? null,
      warnings: attempt.warnings ?? [],
      error: attempt.error ?? null,
    });
    if (attempt.ok && (attempt.assistantMessagePayload || attempt.assistantText)) {
      const payload =
        attempt.assistantMessagePayload && typeof attempt.assistantMessagePayload === "object"
          ? {
              ...attempt.assistantMessagePayload,
              role:
                attempt.assistantMessagePayload.role === "user" ||
                attempt.assistantMessagePayload.role === "system" ||
                attempt.assistantMessagePayload.role === "tool"
                  ? attempt.assistantMessagePayload.role
                  : "assistant",
              ...(attempt.assistantMessagePayload.content !== undefined
                ? {}
                : { content: attempt.assistantText || "" }),
            }
          : {
              role: "assistant" as const,
              content: attempt.assistantText || "",
            };
      const assistantMessage = createSdkMessage({
        type: "assistant",
        message: {
          ...payload,
          ...(attempt.usage ? { usage: attempt.usage } : {}),
          ...(input.selectedModel ? { model: input.selectedModel } : {}),
        } as any,
      });
      return { assistantMessage, updatedFiles: attempt.updatedFiles };
    }

    // QueryEngine-first policy: do not silently fall back to compat in query_engine mode.
    // Surface concrete runtime failure so callers can fix migration gaps directly.
    const failureText = `query_engine_failed: ${attempt.error || "unknown_error"}`;
    const assistantMessage = createSdkMessage({
      type: "assistant",
      message: {
        role: "assistant",
        content: failureText,
      },
    });
    return { assistantMessage, updatedFiles: attempt.updatedFiles };
  }

  const text = `query_engine_failed: runtime_strategy_${input.runtimeStrategy}_unsupported`;
  const assistantMessage = createSdkMessage({
    type: "assistant",
    message: {
      role: "assistant",
      content: text,
    },
  });

  return { assistantMessage };
};
