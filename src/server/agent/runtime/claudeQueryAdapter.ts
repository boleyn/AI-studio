import type { ChatCompletionMessageParam } from "@aistudio/ai/compat/global/core/ai/type";
import type { SdkMessage } from "@shared/chat/sdkMessages";
import { createSdkMessage, sdkContentToText } from "@shared/chat/sdkMessages";
import type { SdkStreamEventName } from "@shared/network/sdkStreamEvents";
import { randomUUID } from "node:crypto";
import type { RuntimeStrategy } from "./runtimeStrategy";
import { runQueryEngineShadowProbe } from "./queryEngineShadowProbe";

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
};

type QueryEngineExecutionAttempt = {
  ok: boolean;
  assistantText?: string;
  stopReason?: string | null;
  warnings?: string[];
  resultSubtype?: string | null;
  error?: string;
};

type ToolInputState = {
  id: string;
  index: number;
  name: string;
  inputBuffer: string;
  lastInput?: unknown;
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
  return sdkContentToText(content);
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
) => {
  const toolName = toolState.name.trim().toLowerCase();
  if (!toolState.id) return;
  if (toolName === "askuserquestion") {
    const payload = normalizePlanQuestionPayload(toolState.lastInput);
    if (!payload) return;
    const dedupeKey = `${toolState.id}:plan_question`;
    if (emittedControlKeys.has(dedupeKey)) return;
    emittedControlKeys.add(dedupeKey);
    input.onEvent("control", {
      interaction: {
        type: "plan_question",
        requestId: toolState.id,
        payload,
      },
    });
    return;
  }
  if (toolName === "exitplanmode") {
    const payload = normalizePlanApprovalPayload(toolState.lastInput);
    const dedupeKey = `${toolState.id}:plan_approval`;
    if (emittedControlKeys.has(dedupeKey)) return;
    emittedControlKeys.add(dedupeKey);
    input.onEvent("control", {
      interaction: {
        type: "plan_approval",
        requestId: toolState.id,
        payload,
      },
    });
    return;
  }
  if (toolName === "update_plan") {
    const payload = normalizePlanProgressPayload(toolState.lastInput);
    if (!payload) return;
    const dedupeKey = `${toolState.id}:plan_progress`;
    if (emittedControlKeys.has(dedupeKey)) return;
    emittedControlKeys.add(dedupeKey);
    input.onEvent("control", {
      interaction: {
        type: "plan_progress",
        requestId: toolState.id,
        payload,
      },
    });
  }
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

  try {
    const configMod = await import("../utils/config");
    const enableConfigs = pickNamedExport<() => void>(configMod, "enableConfigs");
    if (enableConfigs) {
      enableConfigs();
    }

    const cwd = process.cwd();
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
    let assistantText = "";
    let stopReason: string | null = null;
    let resultSubtype: string | null = null;
    const toolStateByIndex = new Map<number, ToolInputState>();
    const toolStateById = new Map<string, ToolInputState>();
    const emittedControlKeys = new Set<string>();

    const canUseTool = async (tool: { name?: string } | undefined, toolInput: unknown) => {
      const toolName = typeof tool?.name === "string" && tool.name.trim() ? tool.name.trim() : "unknown_tool";
      return {
        behavior: "allow",
        updatedInput: toolInput,
        toolUseID: `qe-${toolName}-${Date.now()}`,
      };
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
      abortController: input.abortSignal
        ? (() => {
            const controller = new AbortController();
            if (input.abortSignal.aborted) controller.abort();
            else {
              input.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
            }
            return controller;
          })()
        : undefined,
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
          const nextState: ToolInputState = {
            id,
            name,
            index,
            inputBuffer: "",
            lastInput: stream.event.content_block.input,
          };
          if (index >= 0) toolStateByIndex.set(index, nextState);
          if (id) toolStateById.set(id, nextState);
          input.onEvent("stream_event", {
            subtype: "tool_use_start",
            id,
            name,
            ...(nextState.lastInput !== undefined ? { input: nextState.lastInput } : {}),
          });
          emitPlanControlEventFromTool(input, nextState, emittedControlKeys);
          continue;
        }
        if (streamType === "content_block_delta") {
          const deltaType = stream.event?.delta?.type;
          if (deltaType === "text_delta" && typeof stream.event?.delta?.text === "string") {
            input.onEvent("stream_event", {
              subtype: "text_delta",
              text: stream.event.delta.text,
            });
            continue;
          }
          if (deltaType === "thinking_delta" && typeof stream.event?.delta?.thinking === "string") {
            input.onEvent("stream_event", {
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
              input.onEvent("stream_event", {
                subtype: "tool_use_delta",
                id: state.id,
                name: state.name,
                input: state.lastInput ?? state.inputBuffer,
              });
              emitPlanControlEventFromTool(input, state, emittedControlKeys);
            }
            continue;
          }
        }
      }
      if ((event as { type?: string }).type === "user") {
        const user = event as { message?: { content?: unknown } };
        const blocks = Array.isArray(user.message?.content) ? user.message?.content : [];
        for (const block of blocks) {
          if (!block || typeof block !== "object") continue;
          const record = block as Record<string, unknown>;
          if (record.type !== "tool_result" || typeof record.tool_use_id !== "string") continue;
          const contentText =
            typeof record.content === "string" ? record.content : JSON.stringify(record.content ?? "", null, 2);
          const toolState = toolStateById.get(record.tool_use_id);
          input.onEvent("stream_event", {
            subtype: "tool_result",
            id: record.tool_use_id,
            ...(toolState?.name ? { name: toolState.name } : {}),
            content: contentText,
            ...(record.is_error === true ? { is_error: true } : {}),
          });
        }
      }
      if ((event as { type?: string }).type === "assistant") {
        const msg = event as { message?: { content?: unknown } };
        const text = sdkContentToText(msg.message?.content);
        if (text.trim()) assistantText = text;
      }
      if ((event as { type?: string }).type === "result") {
        const result = event as { subtype?: string; result?: string; stop_reason?: string | null };
        resultSubtype = result.subtype ?? null;
        stopReason = result.stop_reason ?? null;
        if (!assistantText.trim() && typeof result.result === "string" && result.result.trim()) {
          assistantText = result.result;
        }
      }
    }

    if (assistantText.trim()) {
      return {
        ok: true,
        assistantText,
        stopReason,
        resultSubtype,
        warnings: probe.warnings,
      };
    }
    return {
      ok: false,
      warnings: probe.warnings,
      stopReason,
      resultSubtype,
      error: "query_engine_finished_without_assistant_text",
    };
  } catch (error) {
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
      permissionMode:
        typeof input.permissionMode === "string" && input.permissionMode.trim() ? input.permissionMode.trim() : "default",
      resultSubtype: attempt.resultSubtype ?? null,
      stopReason: attempt.stopReason ?? null,
      warnings: attempt.warnings ?? [],
      error: attempt.error ?? null,
    });
    if (attempt.ok && attempt.assistantText) {
      const assistantMessage = createSdkMessage({
        type: "assistant",
        message: {
          role: "assistant",
          content: attempt.assistantText,
        },
      });
      return { assistantMessage };
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
    return { assistantMessage };
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
