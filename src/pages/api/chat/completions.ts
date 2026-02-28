import type { ChatCompletionTool, ChatCompletionMessageParam } from "@aistudio/ai/compat/global/core/ai/type";
import { formatGlobalResult } from "@server/agent/globalResultFormatter";
import { parseGlobalCommand, runGlobalAction, type ChangeTracker } from "@server/agent/globalTools";
import { loadMcpTools } from "@server/agent/mcpClient";
import { BASE_CODING_AGENT_PROMPT } from "@server/agent/prompts/baseCodingAgentPrompt";
import { getAgentRuntimeConfig } from "@server/agent/runtimeConfig";
import { buildSkillsCatalogPrompt } from "@server/agent/skills/prompt";
import { getRuntimeSkills } from "@server/agent/skills/registry";
import { createSkillLoadTool } from "@server/agent/skills/tool";
import { createProjectTools } from "@server/agent/tools";
import type { AgentToolDefinition } from "@server/agent/tools/types";
import { runSimpleAgentWorkflow } from "@server/agent/workflow/simpleAgentWorkflow";
import { getAgentRuntimeSkillPrompt } from "@server/agent/skillPrompt";
import { getChatModelCatalog } from "@server/aiProxy/catalogStore";
import { requireAuth } from "@server/auth/session";
import {
  registerActiveConversationRun,
  unregisterActiveConversationRun,
} from "@server/chat/activeRuns";
import {
  getConversation,
  appendConversationMessages,
  type ConversationMessage,
} from "@server/conversations/conversationStorage";
import { getProject } from "@server/projects/projectStorage";
import { extractText, type IncomingMessage } from "@shared/chat/messages";
import { createId } from "@shared/chat/messages";
import { SseResponseEventEnum } from "@shared/network/sseEvents";
import type { NextApiRequest, NextApiResponse } from "next";

const getToken = (req: NextApiRequest): string | null => {
  const headerToken =
    typeof req.headers["x-project-token"] === "string"
      ? req.headers["x-project-token"]
      : null;
  const queryToken = typeof req.query.token === "string" ? req.query.token : null;
  const bodyToken = typeof req.body?.token === "string" ? req.body.token : null;
  return headerToken ?? bodyToken ?? queryToken;
};

const sendSseEvent = (res: NextApiResponse, event: string, data: string) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
  const streamRes = res as NextApiResponse & { flush?: () => void };
  streamRes.flush?.();
};

const startSse = (res: NextApiResponse) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  const streamRes = res as NextApiResponse & { flushHeaders?: () => void };
  streamRes.flushHeaders?.();
};

const toIncomingMessages = (messages: unknown): IncomingMessage[] => {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => {
      if (!message || typeof message !== "object") return null;
      const record = message as {
        role?: string;
        content?: unknown;
        id?: string;
        name?: string;
        tool_call_id?: string;
        tool_calls?: IncomingMessage["tool_calls"];
        additional_kwargs?: IncomingMessage["additional_kwargs"];
        status?: IncomingMessage["status"];
        artifact?: IncomingMessage["artifact"];
      };
      if (!record.role) return null;
      const role = record.role;
      if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") {
        return null;
      }
      return {
        role,
        content: record.content ?? "",
        id: record.id,
        name: record.name,
        tool_call_id: record.tool_call_id,
        tool_calls: record.tool_calls,
        additional_kwargs: record.additional_kwargs,
        status: record.status,
        artifact: record.artifact,
      } as IncomingMessage;
    })
    .filter((message): message is IncomingMessage => Boolean(message));
};

const CONVERSATION_ROLES = ["user", "assistant", "system", "tool"] as const;
type ConversationRole = (typeof CONVERSATION_ROLES)[number];

const chatCompletionMessageToConversationMessage = (
  message: ChatCompletionMessageParam
): ConversationMessage => {
  const role = CONVERSATION_ROLES.includes(message.role as ConversationRole)
    ? (message.role as ConversationRole)
    : "assistant";
  const content =
    typeof (message as { content?: unknown }).content === "string"
      ? (message as { content: string }).content
      : extractText((message as { content?: unknown }).content);
  return {
    role,
    content: content ?? "",
    id: (message as { id?: string }).id ?? createId(),
    name: (message as { name?: string }).name,
    tool_call_id: (message as { tool_call_id?: string }).tool_call_id,
    tool_calls: (message as { tool_calls?: ConversationMessage["tool_calls"] }).tool_calls,
  };
};

const normalizeStoredMessages = (messages: ConversationMessage[]) => {
  const seen = new Set<string>();
  const result: ConversationMessage[] = [];
  for (const message of [...messages].reverse()) {
    const id = message.id ?? createId();
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({ ...message, id });
  }
  return result.reverse();
};

const toStringValue = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const normalizeToolDetails = (value: unknown) => {
  if (!Array.isArray(value)) return [] as Array<{
    id?: string;
    toolName?: string;
    params?: string;
    response?: string;
  }>;
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : undefined,
      toolName: typeof item.toolName === "string" ? item.toolName : undefined,
      params: typeof item.params === "string" ? item.params : undefined,
      response: typeof item.response === "string" ? item.response : undefined,
    }));
};

const isImageInputPart = (
  value: unknown
): value is { type: "image_url"; image_url: { url: string }; key?: string } => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type !== "image_url") return false;
  if (typeof record.key !== "undefined" && typeof record.key !== "string") return false;
  const imageUrl = record.image_url;
  if (!imageUrl || typeof imageUrl !== "object") return false;
  return typeof (imageUrl as Record<string, unknown>).url === "string";
};

const mergeAssistantToolMessages = (messages: ConversationMessage[]): ConversationMessage[] => {
  const output: ConversationMessage[] = [];
  const pendingCalls = new Map<string, { toolName?: string; params?: string }>();

  const appendToolToLastAssistant = (tool: {
    id?: string;
    toolName?: string;
    params?: string;
    response?: string;
  }) => {
    for (let i = output.length - 1; i >= 0; i -= 1) {
      if (output[i].role !== "assistant") continue;
      const current = output[i];
      const kwargs =
        current.additional_kwargs && typeof current.additional_kwargs === "object"
          ? current.additional_kwargs
          : {};
      const toolDetails = Array.isArray(kwargs.toolDetails) ? kwargs.toolDetails : [];
      output[i] = {
        ...current,
        additional_kwargs: {
          ...kwargs,
          toolDetails: [...toolDetails, tool],
        },
      };
      return;
    }
  };

  for (const message of messages) {
    if (message.role === "assistant") {
      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          if (!call?.id) continue;
          pendingCalls.set(call.id, {
            toolName: call.function?.name,
            params: call.function?.arguments || "",
          });
        }
      }
      output.push(message);
      continue;
    }

    if (message.role === "tool") {
      let parsed: unknown = null;
      if (typeof message.content === "string") {
        try {
          parsed = JSON.parse(message.content || "{}");
        } catch {
          parsed = null;
        }
      }
      const parsedObj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      const toolId =
        message.tool_call_id ||
        (typeof parsedObj.id === "string" ? parsedObj.id : undefined) ||
        message.id;
      const pending = toolId ? pendingCalls.get(toolId) : undefined;
      appendToolToLastAssistant({
        id: toolId,
        toolName:
          message.name ||
          (typeof parsedObj.toolName === "string" ? parsedObj.toolName : undefined) ||
          pending?.toolName ||
          "工具",
        params:
          (typeof parsedObj.params === "string" ? parsedObj.params : undefined) ||
          pending?.params ||
          "",
        response:
          (typeof parsedObj.response === "string" ? parsedObj.response : undefined) ||
          toStringValue(message.content),
      });
      continue;
    }

    output.push(message);
  }

  return output;
};

const getTitleFromMessages = (messages: ConversationMessage[]): string | undefined => {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser) return undefined;
  const text = extractText(lastUser.content).trim();
  if (!text) return undefined;
  return text.length > 40 ? `${text.slice(0, 40)}...` : text;
};

const isModelUnavailableError = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /does not exist|do not have access|model.*not found/i.test(text);
};

const CODE_INTENT_PATTERN =
  /(改|修改|修复|重构|实现|加个|排查|debug|fix|refactor|implement|code|代码|文件|函数|接口|api|bug|报错)/i;
const TOOLING_INTENT_PATTERN =
  /(写工具|工具开发|新增工具|两个工具|2个工具|build tool|create tool|tooling|tool|替换|replace|修改文件|write_file|replace_in_file)/i;

const PROJECT_LOCAL_TOOL_NAMES = new Set([
  "list_files",
  "read_file",
  "write_file",
  "replace_in_file",
  "search_in_files",
  "compile_project",
  "global",
  "skill_load",
]);

const MCP_TOOL_NAME_PREFIX = "mcp_";

const isMcpToolName = (toolName: string) => toolName.startsWith(MCP_TOOL_NAME_PREFIX);

const isProjectKnowledgeMcpTool = (toolName: string) => {
  if (!isMcpToolName(toolName)) return false;
  const normalized = toolName.toLowerCase();
  return (
    normalized.includes("gitlab") ||
    normalized.includes("kb") ||
    normalized.includes("knowledge") ||
    normalized.includes("analysis") ||
    normalized.includes("project")
  );
};

type UserIntent = "tooling" | "coding" | "general";

type ToolRouteResult = {
  selectedTools: AgentToolDefinition[];
  reason: string;
};

const getLastUserText = (messages: ConversationMessage[]) => {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser) return "";
  return extractText(lastUser.content).trim();
};

const getSelectedSkillFromMessages = (messages: ConversationMessage[]) => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") continue;
    const selectedSkill = (message.additional_kwargs as { selectedSkill?: unknown }).selectedSkill;
    if (typeof selectedSkill === "string" && selectedSkill.trim()) {
      return selectedSkill.trim();
    }
  }
  return "";
};

const detectUserIntent = (messages: ConversationMessage[]): UserIntent => {
  const text = getLastUserText(messages).toLowerCase();
  if (!text) return "general";

  if (TOOLING_INTENT_PATTERN.test(text)) return "tooling";
  if (CODE_INTENT_PATTERN.test(text)) return "coding";
  return "general";
};

const routeToolsByIntent = (allTools: AgentToolDefinition[], intent: UserIntent): ToolRouteResult => {
  if (intent === "tooling") {
    const toolBuildTools = allTools.filter((tool) =>
      [
        "list_files",
        "search_in_files",
        "read_file",
        "replace_in_file",
        "write_file",
        "compile_project",
        "global",
        "skill_load",
      ].includes(tool.name)
    );

    if (toolBuildTools.length > 0) {
      return {
        selectedTools: toolBuildTools,
        reason: "tooling_with_edit_tools",
      };
    }

    const fallbackNonLocal = allTools.filter((tool) => !PROJECT_LOCAL_TOOL_NAMES.has(tool.name));
    if (fallbackNonLocal.length > 0) {
      return {
        selectedTools: fallbackNonLocal,
        reason: "tooling_with_non_local_tools",
      };
    }
  }

  if (intent === "coding") {
    const codingTools = allTools.filter(
      (tool) =>
        PROJECT_LOCAL_TOOL_NAMES.has(tool.name) || isMcpToolName(tool.name)
    );

    if (codingTools.length > 0) {
      return {
        selectedTools: codingTools,
        reason: "coding_with_project_tools",
      };
    }
  }

  return {
    selectedTools: allTools,
    reason: "fallback_all_tools",
  };
};

const resolveToolChoice = (intent: UserIntent): "auto" | "required" => {
  if (intent === "tooling") return "required";
  if (intent === "coding") return "required";
  return "auto";
};

const buildToolRoutingSystemPrompt = (
  intent: UserIntent,
  route: ToolRouteResult,
  toolChoiceMode: "auto" | "required"
) => {
  const toolNames = route.selectedTools.map((tool) => tool.name).join(", ") || "(none)";
  const intentRule =
    intent === "tooling"
      ? "Current task intent is tooling. Prefer replace_in_file/write_file/read_file/search_in_files/list_files and make concrete file edits."
      : intent === "coding"
      ? "Current task intent is coding. Prioritize project code tools and available MCP reference tools. Read/search before write."
      : "Current task intent is general. Use tools only when they materially improve correctness.";
  const mandatoryRule =
    toolChoiceMode === "required"
      ? "- You must call at least one allowed tool before providing the final answer."
      : "- Tool calls are optional; use them when needed for correctness.";

  return [
    "Runtime tool routing policy:",
    `- intent: ${intent}`,
    `- route_reason: ${route.reason}`,
    `- tool_choice_mode: ${toolChoiceMode}`,
    `- allowed_tools: ${toolNames}`,
    `- ${intentRule}`,
    "- Do not call tools outside allowed_tools.",
    mandatoryRule,
    "- Prefer the minimum number of tool calls needed to complete the task.",
  ].join("\n");
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const token = getToken(req);
  if (!token) {
    res.status(400).json({ error: "缺少 token 参数" });
    return;
  }

  const incomingMessages = toIncomingMessages(req.body?.messages);
  if (incomingMessages.length === 0) {
    res.status(400).json({ error: "缺少 messages" });
    return;
  }

  const conversationId =
    typeof req.body?.conversation_id === "string"
      ? req.body.conversation_id
      : typeof req.body?.conversationId === "string"
      ? req.body.conversationId
      : undefined;
  const stream = req.body?.stream === true;
  const channel = typeof req.body?.channel === "string" ? req.body.channel : "";
  const modelCatalogKey = typeof req.body?.modelCatalogKey === "string" ? req.body.modelCatalogKey : undefined;
  const model = typeof req.body?.model === "string" ? req.body.model : "agent";
  const selectedSkillInput =
    typeof req.body?.selectedSkill === "string" ? req.body.selectedSkill.trim() : "";
  const created = Math.floor(Date.now() / 1000);
  let streamStarted = false;

  const emitAnswerChunk = (
    text: string,
    finishReason: string | null = null,
    reasoningText?: string
  ) => {
    const delta: Record<string, string> = {};
    if (text) {
      delta.content = text;
    }
    if (reasoningText) {
      delta.reasoning_content = reasoningText;
    }
    sendSseEvent(
      res,
      SseResponseEventEnum.answer,
      JSON.stringify({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta,
            finish_reason: finishReason,
          },
        ],
      })
    );
  };
  const startStream = () => {
    if (streamStarted) return;
    startSse(res);
    streamStarted = true;
  };

  try {
  const project = await getProject(token);
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }

  const conversation = conversationId ? await getConversation(token, conversationId) : null;
  const historyMessages = conversation?.messages ?? [];
  const newMessages = incomingMessages.map((message) => ({
    role: message.role,
    content: message.content,
    id: message.id ?? createId(),
    name: message.name,
    tool_call_id: message.tool_call_id,
    tool_calls: message.tool_calls,
    additional_kwargs: message.additional_kwargs,
    status: message.status,
    artifact: message.artifact,
  }));
  const contextMessages = [...historyMessages, ...newMessages];
  const selectedSkillRequested = selectedSkillInput || getSelectedSkillFromMessages(contextMessages);
  const nextTitleFromInput = getTitleFromMessages(contextMessages);

  const appendAssistantError = async (text: string) => {
    if (!conversationId) return;
    await appendConversationMessages(token, conversationId, [
      { role: "assistant", content: text },
    ]);
  };

  if (conversationId && newMessages.length > 0) {
    const sanitizedMessages = newMessages.map((message) => {
      if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") {
        return message;
      }

      const { imageInputParts: _imageInputParts, ...rest } = message.additional_kwargs as Record<
        string,
        unknown
      >;
      return {
        ...message,
        additional_kwargs: Object.keys(rest).length > 0 ? rest : undefined,
      };
    });

    await appendConversationMessages(token, conversationId, sanitizedMessages, nextTitleFromInput);
  }

  if (incomingMessages[incomingMessages.length - 1]?.role === "user") {
    const lastText = extractText(incomingMessages[incomingMessages.length - 1].content);
    const parsed = parseGlobalCommand(lastText);
    if (parsed) {
      if (!parsed.ok) {
        await appendAssistantError(parsed.message + (parsed.hint ? `\n${parsed.hint}` : ""));
        if (stream) {
          startStream();
          emitAnswerChunk(parsed.message + (parsed.hint ? `\n${parsed.hint}` : ""));
          emitAnswerChunk("", "stop");
          sendSseEvent(res, SseResponseEventEnum.answer, "[DONE]");
          res.end();
          return;
        }
        res.status(200).json({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: parsed.message + (parsed.hint ? `\n${parsed.hint}` : ""),
              },
              finish_reason: "stop",
            },
          ],
        });
        return;
      }

      const tracker: ChangeTracker = { changed: false, paths: new Set() };
      const result = await runGlobalAction(token, parsed.input, tracker);
      const assistantResponse = formatGlobalResult(result);

      if (conversationId) {
        await appendConversationMessages(
          token,
          conversationId,
          [{ role: "assistant", content: assistantResponse }],
          nextTitleFromInput
        );
      }

      if (stream) {
        startStream();
        emitAnswerChunk(assistantResponse);
        emitAnswerChunk("", "stop");
        sendSseEvent(res, SseResponseEventEnum.answer, "[DONE]");
        res.end();
        return;
      }

      res.status(200).json({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: assistantResponse },
            finish_reason: "stop",
          },
        ],
      });
      return;
    }
  }

  const runtimeConfig = getAgentRuntimeConfig();
  if (!runtimeConfig.apiKey) {
    const errorMessage = "缺少 AIPROXY_API_TOKEN/CHAT_API_KEY，无法调用模型。";
    await appendAssistantError(errorMessage);
    res.status(400).json({ error: errorMessage });
    return;
  }

  const tracker: ChangeTracker = { changed: false, paths: new Set() };
  const localTools = createProjectTools(token, tracker);
  const mcpTools = await loadMcpTools();
  const runtimeSkills = await getRuntimeSkills();
  const selectedRuntimeSkill =
    selectedSkillRequested.length > 0
      ? runtimeSkills.find((item) => item.name === selectedSkillRequested) ||
        runtimeSkills.find((item) => item.name.toLowerCase() === selectedSkillRequested.toLowerCase()) ||
        null
      : null;
  const skillLoadTool = runtimeSkills.length > 0 ? await createSkillLoadTool() : null;
  const allTools = [
    ...localTools,
    ...mcpTools,
    ...(skillLoadTool ? [skillLoadTool] : []),
  ];
  const userIntent = detectUserIntent(contextMessages);
  const routedTools = routeToolsByIntent(allTools, userIntent);
  const selectedTools = routedTools.selectedTools;
  const toolChoiceMode = selectedTools.length > 0
    ? selectedRuntimeSkill
      ? "required"
      : resolveToolChoice(userIntent)
    : "auto";
  const toolRoutingPrompt = buildToolRoutingSystemPrompt(userIntent, routedTools, toolChoiceMode);
  const hasMcpTools = selectedTools.some((tool) => isMcpToolName(tool.name));
  const hasProjectKnowledgeTools = selectedTools.some((tool) => isProjectKnowledgeMcpTool(tool.name));
  const requestedModel = model && model !== "agent" ? model : runtimeConfig.toolCallModel;
  const catalog = await getChatModelCatalog({ key: modelCatalogKey }).catch(() => ({
    models: [] as Array<{ id: string; label: string; channel: string; source: "aiproxy" | "env" }>,
    catalogKey: modelCatalogKey || "default",
    defaultModel: requestedModel,
    toolCallModel: runtimeConfig.toolCallModel,
    normalModel: runtimeConfig.normalModel,
    source: "env" as const,
    fetchedAt: new Date().toISOString(),
    warning: "models_catalog_fetch_failed",
  }));
  const availableModels = new Set(catalog.models.map((item) => item.id));
  const filteredCatalogModels = channel
    ? catalog.models.filter((item) => item.channel === channel)
    : catalog.models;
  const availableFilteredModels = new Set(filteredCatalogModels.map((item) => item.id));
  const selectedModel =
    availableFilteredModels.size === 0
      ? availableModels.size === 0
        ? requestedModel
        : availableModels.has(requestedModel)
        ? requestedModel
        : availableModels.has(catalog.defaultModel)
        ? catalog.defaultModel
        : catalog.models[0]?.id || requestedModel
      : availableFilteredModels.has(requestedModel)
      ? requestedModel
      : availableFilteredModels.has(catalog.defaultModel)
      ? catalog.defaultModel
      : filteredCatalogModels[0]?.id || requestedModel;

  const tools: ChatCompletionTool[] = selectedTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  console.info("[agent-skill] tools", {
    userIntent,
    routeReason: routedTools.reason,
    totalTools: tools.length,
    totalCandidates: allTools.length,
    toolChoiceMode,
    toolNames: tools.map((tool) => tool.function.name),
  });

  const toAgentMessages = (messages: ConversationMessage[]): ChatCompletionMessageParam[] =>
    messages.map((message) => {
      const baseText = extractText(message.content);
      const filePrompt =
        message.role === "user" &&
        message.additional_kwargs &&
        typeof message.additional_kwargs.filePrompt === "string"
          ? message.additional_kwargs.filePrompt
          : "";

      const imageInputParts =
        message.role === "user" && message.additional_kwargs
          ? Array.isArray((message.additional_kwargs as Record<string, unknown>).imageInputParts)
            ? ((message.additional_kwargs as Record<string, unknown>).imageInputParts as unknown[]).filter(
                (item): item is { type: "image_url"; image_url: { url: string }; key?: string } =>
                  isImageInputPart(item)
              )
            : []
          : [];

      const content = filePrompt
        ? [baseText, "以下为用户附加文件内容:", filePrompt].filter(Boolean).join("\n\n")
        : baseText;

      if (message.role === "user" && imageInputParts.length > 0) {
        const textForImage = content.trim() || "用户上传了图片，请结合图片内容理解并回答。";
        return {
          role: message.role,
          content: [{ type: "text", text: textForImage }, ...imageInputParts],
          name: message.name,
          tool_call_id: message.tool_call_id,
          tool_calls: message.tool_calls,
        } as ChatCompletionMessageParam;
      }

      return {
        role: message.role,
        content,
        name: message.name,
        tool_call_id: message.tool_call_id,
        tool_calls: message.tool_calls,
      };
    }) as ChatCompletionMessageParam[];

  const skillsCatalogPrompt =
    runtimeSkills.length > 0 ? buildSkillsCatalogPrompt(runtimeSkills) : "";
  const fallbackSkillPrompt =
    runtimeSkills.length === 0 ? await getAgentRuntimeSkillPrompt() : "";
  const baseAgentMessages = toAgentMessages(contextMessages);
  const systemPrompts: ChatCompletionMessageParam[] = [
    { role: "system", content: BASE_CODING_AGENT_PROMPT },
    { role: "system", content: toolRoutingPrompt },
    ...(selectedRuntimeSkill
      ? [
          {
            role: "system",
            content: [
              `User selected skill: ${selectedRuntimeSkill.name}`,
              `You must call tool "skill_load" first with {"skill_name":"${selectedRuntimeSkill.name}"} before executing the task.`,
              "After loading, follow that skill instructions for the rest of the task.",
            ].join("\n"),
          } as ChatCompletionMessageParam,
        ]
      : []),
    ...(skillsCatalogPrompt
      ? [{ role: "system", content: skillsCatalogPrompt } as ChatCompletionMessageParam]
      : []),
    ...(fallbackSkillPrompt
      ? [{ role: "system", content: fallbackSkillPrompt } as ChatCompletionMessageParam]
      : []),
  ];
  const agentMessages = [...systemPrompts, ...baseAgentMessages] as ChatCompletionMessageParam[];

  console.info("[agent-skill] injection", {
    enabled: Boolean(skillsCatalogPrompt || fallbackSkillPrompt),
    skillsCatalogEnabled: Boolean(skillsCatalogPrompt),
    fallbackEnabled: Boolean(fallbackSkillPrompt),
    runtimeSkillCount: runtimeSkills.length,
    skillLoadToolEnabled: Boolean(skillLoadTool),
    hasMcpTools,
    hasProjectKnowledgeTools,
    skillsCatalogPromptLength: skillsCatalogPrompt.length,
    fallbackSkillPromptLength: fallbackSkillPrompt.length,
    userIntent,
    routeReason: routedTools.reason,
    toolChoiceMode,
    selectedSkillRequested,
    selectedSkillResolved: selectedRuntimeSkill?.name || "",
    routedToolCount: selectedTools.length,
    baseMessageCount: baseAgentMessages.length,
    finalMessageCount: agentMessages.length,
    firstRole: agentMessages[0]?.role,
  });

  if (stream) {
    startStream();
  }

  const workflowStartAt = Date.now();
  const workflowAbortController = new AbortController();
  if (conversationId) {
    registerActiveConversationRun({
      token,
      chatId: conversationId,
      controller: workflowAbortController,
    });
  }

  const tryRunWorkflow = async (modelToUse: string) =>
    runSimpleAgentWorkflow({
      selectedModel: modelToUse,
      stream,
      recursionLimit: runtimeConfig.recursionLimit || 6,
      temperature: runtimeConfig.temperature,
      messages: agentMessages,
      toolChoice: toolChoiceMode,
      allTools: selectedTools,
      tools,
      abortSignal: workflowAbortController.signal,
      onEvent: (event, data) => {
        if (!stream) return;

        if (event === SseResponseEventEnum.answer) {
          const text = typeof data.text === "string" ? data.text : "";
          if (!text) return;
          emitAnswerChunk(text);
          return;
        }

        if (event === SseResponseEventEnum.reasoning) {
          const text = typeof data.text === "string" ? data.text : "";
          if (!text) return;
          emitAnswerChunk("", null, text);
          return;
        }

        sendSseEvent(res, event, JSON.stringify(data));
      },
    });

  const fallbackModelCandidates = [
    catalog.defaultModel,
    runtimeConfig.normalModel,
    runtimeConfig.toolCallModel,
  ].filter((item): item is string => Boolean(item && item !== selectedModel));

  const { runResult, finalMessage, finalReasoning, flowResponses } = await (async () => {
    try {
      return await tryRunWorkflow(selectedModel);
    } catch (error) {
      if (isModelUnavailableError(error) && fallbackModelCandidates.length > 0) {
        return await tryRunWorkflow(fallbackModelCandidates[0]);
      }
      throw error;
    } finally {
      if (conversationId) {
        unregisterActiveConversationRun({
          token,
          chatId: conversationId,
          controller: workflowAbortController,
        });
      }
    }
  })();
  const durationSeconds = Number(((Date.now() - workflowStartAt) / 1000).toFixed(2));
  const toolDetailsFromFlow = flowResponses.map((node, index) => ({
    id: `${node.nodeId}-${index}`,
    toolName: node.moduleName,
    params: toStringValue(node.toolInput),
    response: toStringValue(node.toolRes),
  }));
  const resolvedFinalMessage = (() => {
    if (finalMessage) return finalMessage;
    const assistantMessage =
      [...runResult.assistantMessages].reverse().find((item) => item.role === "assistant") ||
      runResult.assistantMessages[runResult.assistantMessages.length - 1];
    if (!assistantMessage || typeof assistantMessage !== "object") return "";
    const reasoning =
      (assistantMessage as { reasoning_text?: unknown; reasoning_content?: unknown })
        .reasoning_text ??
      (assistantMessage as { reasoning_text?: unknown; reasoning_content?: unknown })
        .reasoning_content;
    return typeof reasoning === "string" ? reasoning : "";
  })();

  if (stream) {
    sendSseEvent(
      res,
      SseResponseEventEnum.workflowDuration,
      JSON.stringify({ durationSeconds })
    );
  }

  if (conversationId) {
    const generatedAssistantMessages = runResult.assistantMessages.map(
      chatCompletionMessageToConversationMessage
    );
    const mergedAssistantMessages = mergeAssistantToolMessages(
      normalizeStoredMessages(generatedAssistantMessages)
    );

    const assistantIndex = (() => {
      for (let i = mergedAssistantMessages.length - 1; i >= 0; i -= 1) {
        if (mergedAssistantMessages[i].role === "assistant") return i;
      }
      return -1;
    })();

    let assistantToStore: ConversationMessage | null = null;
    if (assistantIndex >= 0) {
      const current = mergedAssistantMessages[assistantIndex];
      const currentKwargs =
        current.additional_kwargs && typeof current.additional_kwargs === "object"
          ? current.additional_kwargs
          : {};
      const existingToolDetails = normalizeToolDetails(
        (currentKwargs as { toolDetails?: unknown }).toolDetails
      );
      const currentText = extractText(current.content);
      assistantToStore = {
        ...current,
        content: currentText || resolvedFinalMessage,
        additional_kwargs: {
          ...currentKwargs,
          reasoning_text: finalReasoning,
          toolDetails: existingToolDetails.length > 0 ? existingToolDetails : toolDetailsFromFlow,
          responseData: flowResponses,
          durationSeconds,
        },
      };
    } else if (resolvedFinalMessage) {
      assistantToStore = {
        role: "assistant",
        content: resolvedFinalMessage,
        id: createId(),
        additional_kwargs: {
          reasoning_text: finalReasoning,
          toolDetails: toolDetailsFromFlow,
          responseData: flowResponses,
          durationSeconds,
        },
      };
    }

    if (assistantToStore) {
      await appendConversationMessages(token, conversationId, [assistantToStore], nextTitleFromInput);
    }
  }

  if (!stream) {
    res.status(200).json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      responseData: flowResponses,
      durationSeconds,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: resolvedFinalMessage },
          finish_reason: runResult.finish_reason || "stop",
        },
      ],
    });
    return;
  }

  emitAnswerChunk("", "stop");
  sendSseEvent(res, SseResponseEventEnum.answer, "[DONE]");
  res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "未知错误");
    if (stream) {
      startStream();
      emitAnswerChunk(`请求失败: ${message}`);
      emitAnswerChunk("", "stop");
      sendSseEvent(res, SseResponseEventEnum.answer, "[DONE]");
      res.end();
      return;
    }
    res.status(500).json({ error: message });
  }
}
