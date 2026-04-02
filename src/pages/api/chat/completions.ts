import type { ChatCompletionTool, ChatCompletionMessageParam } from "@aistudio/ai/compat/global/core/ai/type";
import { countGptMessagesTokens } from "@aistudio/ai/compat/common/string/tiktoken/index";
import { compressRequestMessages } from "@aistudio/ai/llm/compress";
import { getLLMModel } from "@aistudio/ai/model";
import { loadMcpTools } from "@server/agent/mcpClient";
import { BASE_CODING_AGENT_PROMPT } from "@server/agent/prompts/baseCodingAgentPrompt";
import { collectProjectRuntimeSkills } from "@server/agent/skills/projectRuntimeSkills";
import { getAgentRuntimeConfig } from "@server/agent/runtimeConfig";
import { buildSkillsCatalogPrompt } from "@server/agent/skills/prompt";
import { getRuntimeSkills } from "@server/agent/skills/registry";
import { createProjectTools } from "@server/agent/tools";
import { createBashTool } from "@server/agent/tools/bashTool";
import { mergeAgentTools } from "@server/agent/tools/toolLoader";
import { ProjectWorkspaceManager } from "@server/agent/workspace/projectWorkspaceManager";
import type { AgentToolDefinition, ChangeTracker } from "@server/agent/tools/types";
import { runSimpleAgentWorkflow } from "@server/agent/workflow/simpleAgentWorkflow";
import { getAgentRuntimeSkillPrompt } from "@server/agent/skillPrompt";
import { getChatModelCatalog, getChatModelProfile } from "@server/aiProxy/catalogStore";
import { requireAuth } from "@server/auth/session";
import {
  registerActiveConversationRun,
  unregisterActiveConversationRun,
} from "@server/chat/activeRuns";
import { bindWorkflowAbortToConnection } from "@server/chat/completions/connectionLifecycle";
import {
  getConversation,
  appendConversationMessages,
  type ConversationMessage,
} from "@server/conversations/conversationStorage";
import { getProject } from "@server/projects/projectStorage";
import {
  toArtifactFileParts,
} from "@server/chat/completions/multimodalMemory";
import {
  getHistories,
  type ConversationHistoryWithSummary,
} from "@server/chat/completions/historyMemory";
import {
  mergeAssistantToolMessages,
  normalizeToolDetails,
  toToolMemoryMessages,
} from "@server/chat/completions/toolMemory";
import { createDataId } from "@shared/chat/ids";
import { extractText } from "@shared/chat/messages";
import { SseResponseEventEnum } from "@shared/network/sseEvents";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  ALWAYS_KEEP_TOOL_NAMES,
  buildAttachmentHintText,
  buildToolRoutingSystemPrompt,
  chatCompletionMessageToConversationMessage,
  detectUserIntent,
  getLatestUserArtifactFiles,
  getLastUserText,
  getSelectedSkillFromMessages,
  getTitleFromMessages,
  getToken,
  getUserArtifactFiles,
  isMcpToolName,
  isModelUnavailableError,
  isProjectKnowledgeMcpTool,
  normalizeToolChoiceMode,
  normalizeStoredMessages,
  resolveToolChoice,
  routeToolsByIntent,
  sendSseEvent,
  startSse,
  startSseHeartbeat,
  toIncomingMessages,
  toStringValue,
} from "./completions/helpers";
const CONTEXT_PRECOMPRESS_RATIO = 0.9;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;
  const userId = auth.user._id != null ? String(auth.user._id) : "";
  if (!userId) {
    res.status(401).json({ error: "用户身份无效" });
    return;
  }

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
  const chatId =
    typeof req.body?.chatId === "string"
      ? req.body.chatId
      : typeof req.body?.chat_id === "string"
      ? req.body.chat_id
      : conversationId;
  const stream = req.body?.stream === true;
  const channel = typeof req.body?.channel === "string" ? req.body.channel : "";
  const modelCatalogKey = typeof req.body?.modelCatalogKey === "string" ? req.body.modelCatalogKey : undefined;
  const model = typeof req.body?.model === "string" ? req.body.model : "agent";
  const thinking = (() => {
    const raw = req.body?.thinking;
    if (!raw || typeof raw !== "object") return undefined;
    const type = (raw as { type?: unknown }).type;
    if (type === "enabled") return { type: "enabled" as const };
    if (type === "disabled") return { type: "disabled" as const };
    return undefined;
  })();
  const requestedToolChoiceMode = normalizeToolChoiceMode(
    req.body?.toolChoiceMode ?? req.body?.toolChoice ?? req.body?.tool_choice
  );
  const history = (() => {
    const value = req.body?.history;
    if (value && typeof value === "object" && Array.isArray((value as { histories?: unknown }).histories)) {
      return value as ConversationHistoryWithSummary;
    }
    return Number.MAX_SAFE_INTEGER;
  })();
  const selectedSkillsInput = Array.isArray(req.body?.selectedSkills)
    ? (req.body.selectedSkills as unknown[])
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const selectedSkillInput =
    typeof req.body?.selectedSkill === "string" ? req.body.selectedSkill.trim() : "";
  const created = Math.floor(Date.now() / 1000);
  let streamStarted = false;
  let stopStreamHeartbeat = () => {};
  const persistedTimeline: Array<{
    type: "reasoning" | "answer" | "tool";
    text?: string;
    id?: string;
    toolName?: string;
    params?: string;
    response?: string;
  }> = [];

  const appendTimelineText = (type: "reasoning" | "answer", text: string) => {
    if (!text) return;
    const last = persistedTimeline[persistedTimeline.length - 1];
    if (last && last.type === type && typeof last.text === "string") {
      last.text = `${last.text}${text}`;
      return;
    }
    persistedTimeline.push({ type, text });
  };

  const upsertTimelineTool = (nextPartial: {
    id?: string;
    toolName?: string;
    params?: string;
    response?: string;
  }) => {
    const toolId = typeof nextPartial.id === "string" ? nextPartial.id : "";
    if (toolId) {
      for (let i = persistedTimeline.length - 1; i >= 0; i -= 1) {
        const item = persistedTimeline[i];
        if (item.type !== "tool" || item.id !== toolId) continue;
        item.toolName = nextPartial.toolName ?? item.toolName;
        item.params = `${item.params || ""}${nextPartial.params || ""}`;
        item.response = nextPartial.response ?? item.response;
        return;
      }
    }
    persistedTimeline.push({
      type: "tool",
      id: toolId || undefined,
      toolName: nextPartial.toolName || "",
      params: nextPartial.params || "",
      response: nextPartial.response || "",
    });
  };

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
    stopStreamHeartbeat = startSseHeartbeat(res);
    streamStarted = true;
  };

  try {
  const project = await getProject(token);
  if (!project || project.userId !== userId) {
    res.status(404).json({ error: "项目不存在或无权限访问" });
    return;
  }

  const conversation = conversationId ? await getConversation(token, conversationId) : null;
  const historyMessages = conversation?.messages ?? [];
  const newMessages = incomingMessages.map((message) => ({
    role: message.role,
    content: message.content,
    id: message.id ?? createDataId(),
    name: message.name,
    tool_call_id: message.tool_call_id,
    tool_calls: message.tool_calls,
    additional_kwargs: message.additional_kwargs,
    status: message.status,
    artifact: message.artifact,
  }));
  const historyPayload = getHistories(history, { histories: historyMessages });
  const contextMessages = [...historyPayload.histories, ...newMessages];
  try {
    const historyMeta = contextMessages.map((msg, index) => {
      const imageInputParts =
        msg.role === "user" && msg.additional_kwargs && typeof msg.additional_kwargs === "object"
          ? Array.isArray((msg.additional_kwargs as Record<string, unknown>).imageInputParts)
            ? ((msg.additional_kwargs as Record<string, unknown>).imageInputParts as unknown[]).filter(
                (item) => isImageInputPart(item)
              )
            : []
          : [];
      const artifactFiles =
        msg.role === "user" && msg.artifact && typeof msg.artifact === "object"
          ? Array.isArray((msg.artifact as { files?: unknown }).files)
            ? ((msg.artifact as { files?: unknown }).files as unknown[])
            : []
          : [];
      return {
        i: index,
        role: msg.role,
        id: msg.id,
        textLen: extractText(msg.content).length,
        imageInputParts: imageInputParts.length,
        artifactFiles: artifactFiles.length,
      };
    });
    console.info(
      "[chat-debug][history-selection]",
      JSON.stringify(
        {
          conversationId,
          requestedHistory: history,
          totalStoredHistory: historyMessages.length,
          selectedHistory: historyPayload.histories.length,
          incomingMessages: newMessages.length,
          finalContextMessages: contextMessages.length,
          historyMeta,
        },
        null,
        2
      )
    );
  } catch {}
  const selectedSkillRequested =
    selectedSkillsInput[0] || selectedSkillInput || getSelectedSkillFromMessages(contextMessages);
  const latestUserArtifactFiles = getLatestUserArtifactFiles(contextMessages);
  const nextTitleFromInput = getTitleFromMessages(contextMessages);

  const appendAssistantError = async (text: string) => {
    if (!conversationId) return;
    await appendConversationMessages(token, conversationId, [
      { role: "assistant", content: text },
    ]);
  };

  if (conversationId && newMessages.length > 0) {
    await appendConversationMessages(token, conversationId, newMessages, nextTitleFromInput);
  }

  const runtimeConfig = getAgentRuntimeConfig();
  if (!runtimeConfig.apiKey) {
    const errorMessage = "缺少 AIPROXY_API_TOKEN/CHAT_API_KEY，无法调用模型。";
    await appendAssistantError(errorMessage);
    res.status(400).json({ error: errorMessage });
    return;
  }

  const tracker: ChangeTracker = { changed: false, paths: new Set() };
  const mcpTools = await loadMcpTools();
  const runtimeSkills = await getRuntimeSkills();
  const projectSkillsParsed = collectProjectRuntimeSkills(project.files || {}, `project:${token}`);
  const mergedSkillByName = new Map<string, (typeof runtimeSkills)[number]>();
  for (const skill of runtimeSkills) mergedSkillByName.set(skill.name, skill);
  for (const skill of projectSkillsParsed.skills) mergedSkillByName.set(skill.name, skill);
  const allAvailableSkills = [...mergedSkillByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const selectedResolvedSkill =
    selectedSkillRequested.length > 0
      ? allAvailableSkills.find((item) => item.name === selectedSkillRequested) ||
        allAvailableSkills.find((item) => item.name.toLowerCase() === selectedSkillRequested.toLowerCase()) ||
        null
      : null;
  const selectedRuntimeSkill = selectedResolvedSkill
    ? runtimeSkills.find((item) => item.name === selectedResolvedSkill.name) || null
    : null;
  const selectedProjectSkill =
    selectedResolvedSkill && !selectedRuntimeSkill ? selectedResolvedSkill : null;
  const toolSessionId = `${userId}:${chatId || conversationId || `project-${token}`}`;
  const projectWorkspaceManager = new ProjectWorkspaceManager({
    sessionId: toolSessionId,
    fallbackProjectToken: token,
  });
  const localTools = createProjectTools(token, tracker, {
    chatId,
    workspaceManager: projectWorkspaceManager,
    skillBaseDirs: allAvailableSkills.map((item) => item.baseDir),
  });
  const bashTool = createBashTool({
    sessionId: toolSessionId,
    workspaceManager: projectWorkspaceManager,
    fallbackProjectToken: token,
    allowedProjectToken: token,
  });
  const allTools = mergeAgentTools({
    codingCoreTools: localTools,
    bashTool,
    mcpTools,
  });
  const userIntent = detectUserIntent(contextMessages);
  const routedTools = routeToolsByIntent(allTools, userIntent);
  const selectedTools = (() => {
    const routed = routedTools.selectedTools;
    const keep = allTools.filter((tool) => ALWAYS_KEEP_TOOL_NAMES.has(tool.name));
    const merged = [...routed];
    for (const tool of keep) {
      if (!merged.some((item) => item.name === tool.name)) {
        merged.push(tool);
      }
    }
    return merged;
  })();
  const hasMcpTools = selectedTools.some((tool) => isMcpToolName(tool.name));
  const hasProjectKnowledgeTools = selectedTools.some((tool) => isProjectKnowledgeMcpTool(tool.name));
  const explicitRequestedModel =
    typeof model === "string" && model.trim() && model !== "agent" ? model.trim() : undefined;
  const requestedModel = explicitRequestedModel || runtimeConfig.toolCallModel;
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
    explicitRequestedModel && availableModels.has(explicitRequestedModel)
      ? explicitRequestedModel
      : availableFilteredModels.size === 0
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
  const selectedModelProfile = getChatModelProfile(selectedModel, modelCatalogKey);
  const profileToolChoiceMode = normalizeToolChoiceMode(
    selectedModelProfile?.toolChoiceMode ??
      selectedModelProfile?.toolChoice ??
      selectedModelProfile?.forceToolChoice
  );
  const toolChoiceMode = selectedTools.length > 0
    ? requestedToolChoiceMode ||
      profileToolChoiceMode ||
      (selectedRuntimeSkill
        ? "required"
        : latestUserArtifactFiles.length > 0
        ? "required"
        : resolveToolChoice(userIntent))
    : "auto";
  const toolRoutingPrompt = buildToolRoutingSystemPrompt(userIntent, routedTools, toolChoiceMode);

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

  const toAgentMessages = async (
    messages: ConversationMessage[]
  ): Promise<ChatCompletionMessageParam[]> => {
    const chunks = await Promise.all(
      messages.map(async (message) => {
      const baseText = extractText(message.content);
      const artifactFiles = getUserArtifactFiles(message);
      const attachmentHintText = buildAttachmentHintText(artifactFiles);
      const content =
        attachmentHintText && baseText.trim()
          ? `${baseText}\n\n${attachmentHintText}`
          : attachmentHintText || baseText;
      const artifactFileParts = message.role === "user" ? toArtifactFileParts(message.artifact) : [];

      if (message.role === "assistant") {
        const toolMemoryMessages = toToolMemoryMessages(message);
        const hasInlineToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
        const assistantContentMessage =
          content.trim().length > 0 || hasInlineToolCalls
            ? [
                {
                  role: message.role,
                  content,
                  name: message.name,
                  tool_call_id: message.tool_call_id,
                  tool_calls: message.tool_calls,
                } as ChatCompletionMessageParam,
              ]
            : [];
        return [...toolMemoryMessages, ...assistantContentMessage];
      }

      if (message.role === "user" && artifactFileParts.length > 0) {
        const textForImage = content.trim() || "用户上传了图片和附件，请结合内容理解并回答。";
        return [
          {
            role: message.role,
            content: textForImage,
            name: message.name,
            tool_call_id: message.tool_call_id,
            tool_calls: message.tool_calls,
          } as ChatCompletionMessageParam,
        ];
      }

      return [
        {
          role: message.role,
          content,
          name: message.name,
          tool_call_id: message.tool_call_id,
          tool_calls: message.tool_calls,
        } as ChatCompletionMessageParam,
      ];
    })
    );
    return chunks.flat();
  };

  const skillsCatalogPrompt =
    allAvailableSkills.length > 0 ? buildSkillsCatalogPrompt(allAvailableSkills) : "";
  const runtimeSkillPrompt = await getAgentRuntimeSkillPrompt();
  const buildCoreSystemPrompts = (): ChatCompletionMessageParam[] => [
    { role: "system", content: BASE_CODING_AGENT_PROMPT },
    { role: "system", content: toolRoutingPrompt },
    ...(latestUserArtifactFiles.length > 0
      ? [
          {
            role: "system",
            content: [
              "Current turn includes uploaded attachments.",
              'Before giving the final answer, call tool "Read" for uploaded attachments.',
              "For image attachments, use mode=vision (or mode=auto) with storagePath.",
            ].join("\n"),
          } as ChatCompletionMessageParam,
        ]
      : []),
    ...(selectedRuntimeSkill
      ? [
          {
            role: "system",
            content: [
              `User selected skill: ${selectedRuntimeSkill.name}`,
              `You may call tool "skill_load" with {"name":"${selectedRuntimeSkill.name}"} when you need the full skill instructions.`,
              "Do not force tool calls. If the task is clear, you can reason first and decide whether loading the skill is necessary.",
              "If you load the skill, follow its instructions for the rest of the task.",
            ].join("\n"),
          } as ChatCompletionMessageParam,
        ]
      : []),
    ...(selectedProjectSkill
      ? [
          {
            role: "system",
            content: [
              `User selected project skill: ${selectedProjectSkill.name}`,
              "The following skill content is preloaded. Follow these instructions for this task.",
              selectedProjectSkill.body,
            ].join("\n\n"),
          } as ChatCompletionMessageParam,
        ]
      : []),
    ...(skillsCatalogPrompt
      ? [{ role: "system", content: skillsCatalogPrompt } as ChatCompletionMessageParam]
      : []),
    ...(runtimeSkillPrompt
      ? [{ role: "system", content: runtimeSkillPrompt } as ChatCompletionMessageParam]
      : []),
  ];
  const baseAgentMessages = await toAgentMessages(contextMessages);
  const historyBaseAgentMessages = await toAgentMessages(historyPayload.histories);
  const coreSystemPrompts = buildCoreSystemPrompts();
  const systemPrompts = [...coreSystemPrompts];
  const historySystemPrompts = [...coreSystemPrompts];
  let agentMessages = [...systemPrompts, ...baseAgentMessages] as ChatCompletionMessageParam[];
  const backgroundAgentMessages = [
    ...historySystemPrompts,
    ...historyBaseAgentMessages,
  ] as ChatCompletionMessageParam[];
  const selectedModelInfo = getLLMModel(selectedModel);
  const calcContextUsage = async (messages: ChatCompletionMessageParam[]) => {
    const usedTokens = await countGptMessagesTokens(messages).catch(() => 0);
    const maxContext = Math.max(1, selectedModelInfo.maxContext || 16000);
    return {
      usedTokens,
      maxContext,
      usedRatio: usedTokens / maxContext,
    };
  };
  const beforePrecompressUsage = await calcContextUsage(agentMessages);
  if (beforePrecompressUsage.usedRatio >= CONTEXT_PRECOMPRESS_RATIO) {
    const focusedQuery = getLastUserText(contextMessages);
    const compressed = await compressRequestMessages({
      messages: agentMessages,
      model: selectedModelInfo,
      focusQuery: focusedQuery,
      force: true,
    });
    if (compressed.messages.length > 0) {
      agentMessages = compressed.messages;
    }
    const afterPrecompressUsage = await calcContextUsage(agentMessages);
    console.info("[agent-debug][pre-send-compress]", {
      triggered: true,
      focusedQueryLength: focusedQuery.length,
      thresholdRatio: CONTEXT_PRECOMPRESS_RATIO,
      beforeUsedTokens: beforePrecompressUsage.usedTokens,
      afterUsedTokens: afterPrecompressUsage.usedTokens,
      maxContext: beforePrecompressUsage.maxContext,
      beforeRatio: Number(beforePrecompressUsage.usedRatio.toFixed(4)),
      afterRatio: Number(afterPrecompressUsage.usedRatio.toFixed(4)),
      beforeCount: beforePrecompressUsage.usedTokens,
      afterCount: afterPrecompressUsage.usedTokens,
      beforeMessageCount: systemPrompts.length + baseAgentMessages.length,
      afterMessageCount: agentMessages.length,
    });
  }
  const promptUsedTokens = await countGptMessagesTokens(agentMessages, tools).catch(() => 0);
  const backgroundUsedTokens = await countGptMessagesTokens(backgroundAgentMessages, tools).catch(() => 0);
  const systemAndSkillsTokens = await countGptMessagesTokens(coreSystemPrompts).catch(() => 0);
  const historyTokens = await countGptMessagesTokens(historyBaseAgentMessages).catch(() => 0);
  const historyFileTokens = 0;
  const toolsSchemaTokens = await countGptMessagesTokens([], tools).catch(() => 0);
  const reservedOutputTokens = 0;
  const promptMaxContext = Math.max(1, selectedModelInfo.maxContext || 16000);
  // 统一“窗口占用”口径：usedTokens/usedPercent 表示本次实际请求 prompt（含当前输入）的占用情况。
  const promptBudget = Math.max(1, promptMaxContext - reservedOutputTokens);
  const currentInputTokens = Math.max(0, promptUsedTokens - backgroundUsedTokens);
  const contextWindowUsage = {
    model: selectedModel,
    phase: "start" as const,
    totalPromptTokens: promptUsedTokens,
    currentInputTokens,
    usedTokens: promptUsedTokens,
    maxContext: promptMaxContext,
    remainingTokens: Math.max(0, promptBudget - promptUsedTokens),
    usedPercent: Number(Math.min(100, Math.max(0, (promptUsedTokens / promptBudget) * 100)).toFixed(2)),
    budget: {
      systemAndSkillsTokens,
      historyTokens,
      historyFileTokens,
      toolsSchemaTokens,
      backgroundTokens: backgroundUsedTokens,
      currentInputTokens,
      totalPromptTokens: promptUsedTokens,
      reservedOutputTokens,
    },
  };
  if (stream) {
    startStream();
    sendSseEvent(res, SseResponseEventEnum.contextWindow, JSON.stringify(contextWindowUsage));
  }

  console.info("[agent-skill] injection", {
    enabled: Boolean(skillsCatalogPrompt || runtimeSkillPrompt),
    skillsCatalogEnabled: Boolean(skillsCatalogPrompt),
    runtimeSkillEnabled: Boolean(runtimeSkillPrompt),
    runtimeSkillCount: runtimeSkills.length,
    projectSkillCount: projectSkillsParsed.skills.length,
    availableSkillCount: allAvailableSkills.length,
    skillLoadToolEnabled: selectedTools.some((tool) => tool.name === "skill_load"),
    hasMcpTools,
    hasProjectKnowledgeTools,
    skillsCatalogPromptLength: skillsCatalogPrompt.length,
    runtimeSkillPromptLength: runtimeSkillPrompt.length,
    userIntent,
    routeReason: routedTools.reason,
    toolChoiceMode,
    selectedSkillRequested,
    selectedSkillResolved: selectedResolvedSkill?.name || "",
    selectedSkillSource: selectedProjectSkill ? "project" : selectedRuntimeSkill ? "runtime" : "",
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
  const cleanupDisconnectBinding = bindWorkflowAbortToConnection({
    req,
    res,
    controller: workflowAbortController,
    scope: "chat/completions",
  });
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
      thinking,
      messages: agentMessages,
      toolChoice: toolChoiceMode,
      allTools: selectedTools,
      tools,
      abortSignal: workflowAbortController.signal,
      onEvent: (event, data) => {
        if (event === SseResponseEventEnum.answer) {
          const text = typeof data.text === "string" ? data.text : "";
          if (!text) return;
          appendTimelineText("answer", text);
          if (!stream) return;
          emitAnswerChunk(text);
          return;
        }

        if (event === SseResponseEventEnum.reasoning) {
          const text = typeof data.text === "string" ? data.text : "";
          if (!text) return;
          appendTimelineText("reasoning", text);
          if (!stream) return;
          emitAnswerChunk("", null, text);
          return;
        }

        if (event === SseResponseEventEnum.toolCall) {
          upsertTimelineTool({
            id: typeof data.id === "string" ? data.id : undefined,
            toolName: typeof data.toolName === "string" ? data.toolName : undefined,
          });
        } else if (event === SseResponseEventEnum.toolParams) {
          upsertTimelineTool({
            id: typeof data.id === "string" ? data.id : undefined,
            toolName: typeof data.toolName === "string" ? data.toolName : undefined,
            params: typeof data.params === "string" ? data.params : "",
          });
        } else if (event === SseResponseEventEnum.toolResponse) {
          upsertTimelineTool({
            id: typeof data.id === "string" ? data.id : undefined,
            toolName: typeof data.toolName === "string" ? data.toolName : undefined,
            response: typeof data.response === "string" ? data.response : "",
          });
        }

        if (!stream) return;
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
      cleanupDisconnectBinding();
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
  const finalPromptUsedTokens = await countGptMessagesTokens(runResult.completeMessages, tools).catch(() => 0);
  const finalCurrentInputTokens = Math.max(0, finalPromptUsedTokens - backgroundUsedTokens);
  const finalContextWindowUsage = {
    ...contextWindowUsage,
    phase: "final" as const,
    totalPromptTokens: finalPromptUsedTokens,
    currentInputTokens: finalCurrentInputTokens,
    usedTokens: finalPromptUsedTokens,
    remainingTokens: Math.max(0, promptBudget - finalPromptUsedTokens),
    usedPercent: Number(Math.min(100, Math.max(0, (finalPromptUsedTokens / promptBudget) * 100)).toFixed(2)),
    budget: {
      ...contextWindowUsage.budget,
      currentInputTokens: finalCurrentInputTokens,
      totalPromptTokens: finalPromptUsedTokens,
    },
  };
  const normalizeToolPayloadForMatch = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      return trimmed.replace(/\s+/g, " ");
    }
  };
  const buildToolFingerprint = (toolName: string, params: string, response: string) =>
    `${toolName.trim().toLowerCase()}::${normalizeToolPayloadForMatch(params)}::${normalizeToolPayloadForMatch(response)}`;
  const timelineToolCandidates = persistedTimeline
    .map((item, index) => ({ item, index }))
    .filter(
      (entry): entry is { item: { type: "tool"; id?: string; toolName?: string; params?: string; response?: string }; index: number } =>
        entry.item.type === "tool"
    );
  const usedTimelineToolIndexes = new Set<number>();
  const pickTimelineToolId = (toolName: string, params: string, response: string) => {
    const targetFingerprint = buildToolFingerprint(toolName, params, response);
    for (const candidate of timelineToolCandidates) {
      if (usedTimelineToolIndexes.has(candidate.index)) continue;
      if (!candidate.item.id) continue;
      const candidateFingerprint = buildToolFingerprint(
        candidate.item.toolName || "",
        candidate.item.params || "",
        candidate.item.response || ""
      );
      if (candidateFingerprint !== targetFingerprint) continue;
      usedTimelineToolIndexes.add(candidate.index);
      return candidate.item.id;
    }
    for (const candidate of timelineToolCandidates) {
      if (usedTimelineToolIndexes.has(candidate.index)) continue;
      if (!candidate.item.id) continue;
      const sameName =
        (candidate.item.toolName || "").trim().toLowerCase() === toolName.trim().toLowerCase();
      if (!sameName) continue;
      usedTimelineToolIndexes.add(candidate.index);
      return candidate.item.id;
    }
    return undefined;
  };
  const toolDetailsFromFlow = flowResponses.map((node, index) => {
    const toolName = node.moduleName || "";
    const params = toStringValue(node.toolInput);
    const response = toStringValue(node.toolRes);
    return {
      id: pickTimelineToolId(toolName, params, response) || `${node.nodeId}-${index}`,
      toolName,
      params,
      response,
    };
  });
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
    sendSseEvent(res, SseResponseEventEnum.contextWindow, JSON.stringify(finalContextWindowUsage));
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
          ...(persistedTimeline.length > 0 ? { timeline: persistedTimeline } : {}),
          responseData: flowResponses,
          durationSeconds,
          contextWindow: finalContextWindowUsage,
        },
      };
    } else if (resolvedFinalMessage) {
      assistantToStore = {
        role: "assistant",
        content: resolvedFinalMessage,
        id: createDataId(),
        additional_kwargs: {
          reasoning_text: finalReasoning,
          toolDetails: toolDetailsFromFlow,
          ...(persistedTimeline.length > 0 ? { timeline: persistedTimeline } : {}),
          responseData: flowResponses,
          durationSeconds,
          contextWindow: finalContextWindowUsage,
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
      contextWindow: finalContextWindowUsage,
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
  stopStreamHeartbeat();
  res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "未知错误");
    if (stream) {
      startStream();
      emitAnswerChunk(`请求失败: ${message}`);
      emitAnswerChunk("", "stop");
      sendSseEvent(res, SseResponseEventEnum.answer, "[DONE]");
      stopStreamHeartbeat();
      res.end();
      return;
    }
    res.status(500).json({ error: message });
  }
}
