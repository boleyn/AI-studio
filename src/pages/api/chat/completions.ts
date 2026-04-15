import type { ChatCompletionTool, ChatCompletionMessageParam } from "@aistudio/ai/compat/global/core/ai/type";
import { countGptMessagesTokens } from "@aistudio/ai/compat/common/string/tiktoken/index";
import { getLLMModel } from "@aistudio/ai/model";
import { createLLMResponse } from "@aistudio/ai/llm/request";
import { loadMcpTools } from "@server/agent/mcpClient";
import { getBaseCodingAgentPrompt } from "@server/agent/prompts/baseCodingAgentPrompt";
import { collectProjectRuntimeSkills } from "@server/agent/skills/projectRuntimeSkills";
import { getAgentRuntimeConfig } from "@server/agent/runtimeConfig";
import { buildSkillsCatalogPrompt } from "@server/agent/skills/prompt";
import { getRuntimeSkills } from "@server/agent/skills/registry";
import { createSkillLoadTool, createSkillRunScriptTool } from "@server/agent/skills/tool";
import { createProjectTools } from "@server/agent/tools";
import { createBashTool } from "@server/agent/tools/bashTool";
import { createPlanModeTools } from "@server/agent/tools/planModeTools";
import { derivePlanModeState } from "@server/agent/permissions/planMode";
import { createSubAgentTools } from "@server/agent/tools/subAgentTools";
import { createTaskTools } from "@server/agent/tools/taskTools";
import { ProjectWorkspaceManager } from "@server/agent/workspace/projectWorkspaceManager";
import type { AgentToolDefinition, ChangeTracker } from "@server/agent/tools/types";
import { runMasterSubAgentRuntime } from "@server/agent/runtime/masterSubAgentRuntime";
import { getAgentRuntimeSkillPrompt } from "@server/agent/skillPrompt";
import { getChatModelCatalog, getChatModelProfile, runWithRequestModelProfiles } from "@server/aiProxy/catalogStore";
import { requireAuth } from "@server/auth/session";
import { getUserModelConfigsFromUser, toUserModelProfileMap } from "@server/auth/userModelConfig";
import {
  registerActiveConversationRun,
  unregisterActiveConversationRun,
} from "@server/chat/activeRuns";
import { bindAgentAbortToConnection } from "@server/chat/completions/agentConnectionLifecycle";
import {
  getConversation,
  appendConversationMessages,
  type ConversationMessage,
} from "@server/conversations/conversationStorage";
import { getProject } from "@server/projects/projectStorage";
import {
  toArtifactFileParts,
} from "@server/chat/completions/multimodalMemory";
import { manageContextWindow } from "@server/chat/completions/contextManager";
import { assemblePrompts } from "@server/chat/completions/promptAssembler";
import {
  buildProjectMemoryContextPrompt,
  extractAndPersistProjectMemories,
  getProjectMemoryBehaviorPrompt,
  recallProjectMemoriesWithModel,
  type ProjectMemoryRecall,
  type ProjectMemoryUpdateResult,
} from "@server/chat/completions/projectMemory";
import {
  getHistories,
  type ConversationHistoryWithSummary,
} from "@server/chat/completions/historyMemory";
import {
  mergeAssistantToolMessages,
  normalizeToolDetails,
  toToolMemoryMessages,
} from "@server/chat/completions/toolMemory";
import {
  mergeAssistantAdditionalKwargs,
  resolveAssistantContentForPersistence,
} from "./completions/persistenceMerge";
import { createDataId } from "@shared/chat/ids";
import { extractText } from "@shared/chat/messages";
import { SseResponseEventEnum } from "@shared/network/sseEvents";
import { isPlanInteractionEnvelope, type PlanInteractionEnvelope } from "@shared/chat/planInteraction";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  ALWAYS_KEEP_TOOL_NAMES,
  buildAttachmentHintText,
  chatCompletionMessageToConversationMessage,
  getLatestUserArtifactFiles,
  getLastUserText,
  getSelectedSkillFromMessages,
  getTitleFromMessages,
  getToken,
  getUserArtifactFiles,
  isMcpToolName,
  isModelUnavailableError,
  isProjectKnowledgeMcpTool,
  normalizeStoredMessages,
  sendSseEvent,
  startSse,
  startSseHeartbeat,
  toIncomingMessages,
  toStringValue,
} from "./completions/helpers";

const PLAN_MODE_BLOCKED_TOOL_NAMES = new Set([
  "Write",
  "Edit",
  "Delete",
  "bash",
  "compile_project",
  "skill_run_script",
  "spawn_agent",
  "send_input",
  "send_message",
  "close_agent",
  "resume_agent",
]);

const isImageInputPart = (value: unknown) => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  return type === "image_url" || type === "image";
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
  const chatId =
    typeof req.body?.chatId === "string"
      ? req.body.chatId
      : typeof req.body?.chat_id === "string"
      ? req.body.chat_id
      : conversationId;
  const stream = req.body?.stream === true;
  const persistIncomingMessages = req.body?.persistIncomingMessages !== false;
  const channel = typeof req.body?.channel === "string" ? req.body.channel : "";
  const modelCatalogKey = typeof req.body?.modelCatalogKey === "string" ? req.body.modelCatalogKey : undefined;
  const continueAssistantMessageId =
    typeof req.body?.continueAssistantMessageId === "string"
      ? req.body.continueAssistantMessageId.trim()
      : "";
  const model = typeof req.body?.model === "string" ? req.body.model : "agent";
  const thinking = (() => {
    const raw = req.body?.thinking;
    if (!raw || typeof raw !== "object") return undefined;
    const type = (raw as { type?: unknown }).type;
    if (type === "enabled") return { type: "enabled" as const };
    if (type === "disabled") return { type: "disabled" as const };
    return undefined;
  })();
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
  const userModelConfigs = getUserModelConfigsFromUser(auth.user);
  const userModelProfiles = toUserModelProfileMap(userModelConfigs);
  let streamStarted = false;
  let stopStreamHeartbeat = () => {};
  const persistedTimeline: Array<{
    type: "reasoning" | "answer" | "tool";
    text?: string;
    id?: string;
    toolName?: string;
    params?: string;
    response?: string;
    interaction?: PlanInteractionEnvelope;
    progressStatus?: "pending" | "in_progress" | "completed" | "error";
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
    interaction?: PlanInteractionEnvelope;
    progressStatus?: "pending" | "in_progress" | "completed" | "error";
  }) => {
    const toolId = typeof nextPartial.id === "string" ? nextPartial.id : "";
    if (toolId) {
      for (let i = persistedTimeline.length - 1; i >= 0; i -= 1) {
        const item = persistedTimeline[i];
        if (item.type !== "tool" || item.id !== toolId) continue;
        item.toolName = nextPartial.toolName ?? item.toolName;
        item.params = `${item.params || ""}${nextPartial.params || ""}`;
        item.response = nextPartial.response ?? item.response;
        item.interaction = nextPartial.interaction ?? item.interaction;
        item.progressStatus = nextPartial.progressStatus ?? item.progressStatus;
        return;
      }
    }
    persistedTimeline.push({
      type: "tool",
      id: toolId || undefined,
      toolName: nextPartial.toolName || "",
      params: nextPartial.params || "",
      response: nextPartial.response || "",
      interaction: nextPartial.interaction,
      progressStatus: nextPartial.progressStatus,
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
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
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

  if (persistIncomingMessages && conversationId && newMessages.length > 0) {
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
  const toolSessionId = chatId || conversationId || `project-${token}`;
  const projectWorkspaceManager = new ProjectWorkspaceManager({
    sessionId: toolSessionId,
    fallbackProjectToken: token,
  });
  const localTools = createProjectTools(token, tracker, {
    chatId,
    workspaceManager: projectWorkspaceManager,
    skillBaseDirs: allAvailableSkills.map((item) => item.baseDir),
    historyMessages: contextMessages,
  });
  const skillLoadTool = allAvailableSkills.length > 0 ? await createSkillLoadTool({ skills: allAvailableSkills }) : null;
  const skillRunScriptTool =
    allAvailableSkills.length > 0
      ? await createSkillRunScriptTool({
          skills: allAvailableSkills,
          sessionId: toolSessionId,
          workspaceFiles: project.files || {},
          workspaceManager: projectWorkspaceManager,
          projectToken: token,
        })
      : null;
  const bashTool = createBashTool({
    sessionId: toolSessionId,
    workspaceManager: projectWorkspaceManager,
    fallbackProjectToken: token,
    allowedProjectToken: token,
  });
  const baseTools = [
    ...localTools,
    ...mcpTools,
    ...(skillLoadTool ? [skillLoadTool] : []),
    ...(skillRunScriptTool ? [skillRunScriptTool] : []),
    bashTool,
  ];
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
  const userCatalogModels = userModelConfigs.map((item) => ({
    id: item.id,
    label: item.label || item.id,
    channel: "user",
    source: "user" as const,
  }));
  const combinedCatalogModels = [...userCatalogModels, ...catalog.models];
  const availableModels = new Set(combinedCatalogModels.map((item) => item.id));
  const filteredCatalogModels = channel
    ? combinedCatalogModels.filter((item) => item.channel === channel)
    : combinedCatalogModels;
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
        : combinedCatalogModels[0]?.id || requestedModel
      : availableFilteredModels.has(requestedModel)
      ? requestedModel
      : availableFilteredModels.has(catalog.defaultModel)
      ? catalog.defaultModel
      : filteredCatalogModels[0]?.id || requestedModel;
  let subagentContextMessages: ChatCompletionMessageParam[] = [];
  let allTools: AgentToolDefinition[] = [];
  const subAgentTools = createSubAgentTools({
    sessionId: toolSessionId,
    getSelectedModel: () => selectedModel,
    recursionLimit: runtimeConfig.recursionLimit,
    temperature: runtimeConfig.temperature,
    getContextMessages: () => subagentContextMessages,
    getDelegatableTools: () => allTools,
  });
  const taskTools = createTaskTools(toolSessionId);
  const latestUserMessage = [...contextMessages].reverse().find((item) => item.role === "user");
  const latestUserKwargs =
    latestUserMessage?.additional_kwargs && typeof latestUserMessage.additional_kwargs === "object"
      ? (latestUserMessage.additional_kwargs as Record<string, unknown>)
      : null;
  const latestPlanQuestionResponse =
    latestUserKwargs?.planQuestionResponse &&
    typeof latestUserKwargs.planQuestionResponse === "object" &&
    !Array.isArray(latestUserKwargs.planQuestionResponse)
      ? (latestUserKwargs.planQuestionResponse as { answers?: Record<string, unknown> })
      : null;
  const latestExecuteDecision =
    latestPlanQuestionResponse?.answers &&
    typeof latestPlanQuestionResponse.answers === "object" &&
    !Array.isArray(latestPlanQuestionResponse.answers)
      ? String(
          (latestPlanQuestionResponse.answers as Record<string, unknown>).plan_execute_confirm || ""
        ).trim()
      : "";
  const planExecutionConfirmed = latestExecuteDecision === "确认执行";
  const plannedStepCount = (() => {
    for (let i = contextMessages.length - 1; i >= 0; i -= 1) {
      const message = contextMessages[i];
      if (message.role !== "assistant") continue;
      const kwargs =
        message.additional_kwargs && typeof message.additional_kwargs === "object"
          ? (message.additional_kwargs as Record<string, unknown>)
          : null;
      if (!kwargs) continue;
      const planProgress =
        kwargs.planProgress && typeof kwargs.planProgress === "object" && !Array.isArray(kwargs.planProgress)
          ? (kwargs.planProgress as { plan?: unknown })
          : null;
      if (!planProgress || !Array.isArray(planProgress.plan)) continue;
      const validPlan = planProgress.plan.filter(
        (item): item is { step?: unknown; status?: unknown } => Boolean(item && typeof item === "object")
      );
      if (validPlan.length > 0) return validPlan.length;
    }
    return 0;
  })();
  const planModeActive = planExecutionConfirmed ? false : derivePlanModeState(contextMessages);
  const planModeTools = createPlanModeTools();
  const updatePlanTool = planModeTools.find((tool) => tool.name === "update_plan");
  allTools = [
    ...baseTools,
    ...subAgentTools,
    ...taskTools,
    ...(updatePlanTool ? [updatePlanTool] : []),
    ...(planModeActive ? planModeTools.filter((tool) => tool.name === "request_user_input") : []),
  ];
  const selectedTools = (() => {
    const merged = [...allTools];
    for (const tool of allTools.filter((item) => ALWAYS_KEEP_TOOL_NAMES.has(item.name))) {
      if (!merged.some((item) => item.name === tool.name)) {
        merged.push(tool);
      }
    }
    if (planModeActive) {
      return merged.filter((tool) => !PLAN_MODE_BLOCKED_TOOL_NAMES.has(tool.name));
    }
    return merged;
  })();
  const hasMcpTools = selectedTools.some((tool) => isMcpToolName(tool.name));
  const hasProjectKnowledgeTools = selectedTools.some((tool) => isProjectKnowledgeMcpTool(tool.name));
  const hasSpawnAgentTool = selectedTools.some((tool) => (tool.name || "").trim().toLowerCase() === "spawn_agent");
  const delegationGuidancePrompt = (() => {
    if (!planExecutionConfirmed) return "";
    if (!hasSpawnAgentTool) {
      return "Subagent tools are unavailable in this run. Execute directly in the master agent and keep update_plan progress in sync.";
    }
    const complexityScore =
      (plannedStepCount >= 4 ? 2 : plannedStepCount >= 2 ? 1 : 0) +
      (selectedTools.length >= 24 ? 1 : 0);
    if (complexityScore >= 2) {
      return "Delegation is recommended: for multi-step or broad-scope work, call spawn_agent for at least one bounded implementation subtask, then integrate outputs and continue.";
    }
    return "Delegation is optional: proceed directly when scope is small, otherwise delegate bounded side tasks via spawn_agent.";
  })();
  const selectedModelProfile = userModelProfiles.get(selectedModel) || getChatModelProfile(selectedModel, modelCatalogKey);
  const fixedToolChoice: "auto" = "auto";

  const tools: ChatCompletionTool[] = selectedTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  console.info("[agent-skill] tools", {
    totalTools: tools.length,
    totalCandidates: allTools.length,
    toolChoiceMode: fixedToolChoice,
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
  const latestUserQuery = getLastUserText(contextMessages);
  const runMemoryModelQuery = async ({ system, user }: { system: string; user: string }) => {
    const profile = userModelProfiles.get(selectedModel);
    const baseUrl = typeof profile?.baseUrl === "string" ? profile.baseUrl.trim() : undefined;
    const key = typeof profile?.key === "string" ? profile.key.trim() : undefined;
    const result = await runWithRequestModelProfiles(userModelProfiles, async () =>
      createLLMResponse({
        throwError: false,
        userKey: baseUrl || key ? { baseUrl, key } : undefined,
        body: {
          model: selectedModel,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0,
          stream: false,
        } as any,
      })
    );
    return result.answerText || "";
  };
  const memoryRecall: ProjectMemoryRecall | null = runtimeConfig.memoryEnabled
    ? await recallProjectMemoriesWithModel({
        projectToken: token,
        query: latestUserQuery,
        llmSelect: runMemoryModelQuery,
      }).catch(() => null)
    : null;
  const memoryContextPrompt = memoryRecall ? buildProjectMemoryContextPrompt(memoryRecall) : "";

  const baseAgentMessages = await toAgentMessages(contextMessages);
  const historyBaseAgentMessages = await toAgentMessages(historyPayload.histories);

  const coreSystemPrompts: ChatCompletionMessageParam[] = [
    { role: "system", content: getBaseCodingAgentPrompt(project.template) },
    ...(planModeActive
      ? [
          {
            role: "system",
            content:
              "Plan mode is active. Do not perform mutating operations. First call update_plan with concise executable checklist, then wait for execution confirmation. Keep prose minimal.",
          } as ChatCompletionMessageParam,
        ]
      : []),
    ...(planExecutionConfirmed
      ? [
          {
            role: "system",
            content:
              "User confirmed execution. Do not re-plan. Start implementing immediately from the first pending step, keep update_plan status in sync, and complete all steps end-to-end.",
          } as ChatCompletionMessageParam,
          ...(delegationGuidancePrompt
            ? [
                {
                  role: "system",
                  content: delegationGuidancePrompt,
                } as ChatCompletionMessageParam,
              ]
            : []),
        ]
      : []),
    ...(skillsCatalogPrompt
      ? [{ role: "system", content: skillsCatalogPrompt } as ChatCompletionMessageParam]
      : []),
    ...(runtimeSkillPrompt
      ? [{ role: "system", content: runtimeSkillPrompt } as ChatCompletionMessageParam]
      : []),
  ];
  const taskConstraintPrompts: ChatCompletionMessageParam[] = [
    ...(latestUserArtifactFiles.length > 0
      ? [
          {
            role: "system",
            content: [
              "Current turn includes uploaded attachments.",
              'Before giving the final answer, call tool "Read" for uploaded attachments.',
              'Use Read with file_path (for example "/.files/<filename>").',
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
  ];
  const memoryPrompts: ChatCompletionMessageParam[] = runtimeConfig.memoryEnabled
    ? [
        { role: "system", content: getProjectMemoryBehaviorPrompt() } as ChatCompletionMessageParam,
        ...(memoryContextPrompt
          ? [{ role: "system", content: memoryContextPrompt } as ChatCompletionMessageParam]
          : []),
      ]
    : [];

  const assembled = assemblePrompts({
    coreSystemPrompts,
    contextMessages: baseAgentMessages,
    taskConstraintPrompts,
    memoryPrompts,
  });
  const backgroundAssembled = assemblePrompts({
    coreSystemPrompts,
    contextMessages: historyBaseAgentMessages,
    taskConstraintPrompts,
    memoryPrompts,
  });

  const selectedModelInfo = await runWithRequestModelProfiles(userModelProfiles, async () =>
    getLLMModel(selectedModel)
  );
  const contextManaged = await manageContextWindow({
    messages: assembled.messages,
    tools,
    model: selectedModelInfo,
    focusQuery: latestUserQuery,
    enabled: runtimeConfig.contextManagerEnabled,
  });
  let agentMessages = contextManaged.messages;
  subagentContextMessages = agentMessages;

  const promptUsedTokens = await countGptMessagesTokens(agentMessages, tools).catch(() => 0);
  const backgroundUsedTokens = await countGptMessagesTokens(backgroundAssembled.messages, tools).catch(() => 0);
  const systemAndSkillsTokens = await countGptMessagesTokens(assembled.systemPrompts).catch(() => 0);
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
    contextManagement: contextManaged.meta,
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
    skillLoadToolEnabled: Boolean(skillLoadTool),
    hasMcpTools,
    hasProjectKnowledgeTools,
    skillsCatalogPromptLength: skillsCatalogPrompt.length,
    runtimeSkillPromptLength: runtimeSkillPrompt.length,
    toolChoiceMode: fixedToolChoice,
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

  const agentRuntimeStartAt = Date.now();
  const agentRuntimeAbortController = new AbortController();
  const cleanupDisconnectBinding = bindAgentAbortToConnection({
    req,
    res,
    controller: agentRuntimeAbortController,
    scope: "chat/completions",
  });
  if (conversationId) {
    registerActiveConversationRun({
      token,
      chatId: conversationId,
      controller: agentRuntimeAbortController,
    });
  }

  const tryRunAgentRun = async (modelToUse: string) =>
    runWithRequestModelProfiles(userModelProfiles, async () =>
      runMasterSubAgentRuntime({
        sessionId: toolSessionId,
        selectedModel: modelToUse,
        stream,
        recursionLimit: runtimeConfig.recursionLimit,
        temperature: runtimeConfig.temperature,
        userKey: (() => {
          const profile = userModelProfiles.get(modelToUse);
          const baseUrl = typeof profile?.baseUrl === "string" ? profile.baseUrl.trim() : undefined;
          const key = typeof profile?.key === "string" ? profile.key.trim() : undefined;
          return baseUrl || key ? { baseUrl, key } : undefined;
        })(),
        thinking,
        messages: agentMessages,
        toolChoice: fixedToolChoice,
        allTools: selectedTools,
        tools,
        pauseOnPlanInteraction: planModeActive && !planExecutionConfirmed,
        abortSignal: agentRuntimeAbortController.signal,
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
            progressStatus: "pending",
          });
        } else if (event === SseResponseEventEnum.toolParams) {
          upsertTimelineTool({
            id: typeof data.id === "string" ? data.id : undefined,
            toolName: typeof data.toolName === "string" ? data.toolName : undefined,
            params: typeof data.params === "string" ? data.params : "",
          });
        } else if (event === SseResponseEventEnum.toolInteraction) {
          const interaction = isPlanInteractionEnvelope(data.interaction)
            ? data.interaction
            : undefined;
          upsertTimelineTool({
            id: typeof data.id === "string" ? data.id : undefined,
            toolName: typeof data.toolName === "string" ? data.toolName : undefined,
            interaction,
          });
        } else if (event === SseResponseEventEnum.toolProgress) {
          const nextStatus =
            data.status === "pending" ||
            data.status === "in_progress" ||
            data.status === "completed" ||
            data.status === "error"
              ? data.status
              : undefined;
          upsertTimelineTool({
            id: typeof data.id === "string" ? data.id : undefined,
            toolName: typeof data.toolName === "string" ? data.toolName : undefined,
            progressStatus: nextStatus,
          });
        } else if (event === SseResponseEventEnum.toolResponse) {
          const interaction = isPlanInteractionEnvelope(data.interaction)
            ? data.interaction
            : undefined;
          upsertTimelineTool({
            id: typeof data.id === "string" ? data.id : undefined,
            toolName: typeof data.toolName === "string" ? data.toolName : undefined,
            response: typeof data.response === "string" ? data.response : "",
            interaction,
            progressStatus: "completed",
          });
        }

        if (!stream) return;
          sendSseEvent(res, event, JSON.stringify(data));
        },
      })
    );

  const fallbackModelCandidates = [
    catalog.defaultModel,
    runtimeConfig.normalModel,
    runtimeConfig.toolCallModel,
  ].filter((item): item is string => Boolean(item && item !== selectedModel));

  const { runResult, finalMessage, finalReasoning, stepResponses } = await (async () => {
    try {
      return await tryRunAgentRun(selectedModel);
    } catch (error) {
      if (isModelUnavailableError(error) && fallbackModelCandidates.length > 0) {
        return await tryRunAgentRun(fallbackModelCandidates[0]);
      }
      throw error;
    } finally {
      cleanupDisconnectBinding();
      if (conversationId) {
        unregisterActiveConversationRun({
          token,
          chatId: conversationId,
          controller: agentRuntimeAbortController,
        });
      }
    }
  })();
  const enforceSpawnDelegationPolicy = process.env.AISTUDIO_ENFORCE_SPAWN_AGENT_POLICY === "true";
  const enforceUpdatePlanProgressPolicy =
    process.env.AISTUDIO_ENFORCE_UPDATE_PLAN_PROGRESS_POLICY === "true";
  const spawnedAgent = stepResponses.some((node) => node.moduleName === "spawn_agent");
  if (planExecutionConfirmed) {
    const updatePlanSnapshots = stepResponses
      .filter((node) => node.moduleName === "update_plan")
      .map((node) => {
        const toolRes = node.toolRes;
        if (!toolRes || typeof toolRes !== "object" || Array.isArray(toolRes)) return null;
        const interactionValue = (toolRes as { interaction?: unknown }).interaction;
        if (!isPlanInteractionEnvelope(interactionValue) || interactionValue.type !== "plan_progress") {
          return null;
        }
        const payload = interactionValue.payload;
        const plan = Array.isArray((payload as { plan?: unknown }).plan)
          ? ((payload as { plan: Array<{ step?: unknown; status?: unknown }> }).plan || [])
              .filter((item) => Boolean(item && typeof item === "object" && typeof item.step === "string"))
              .map((item) => ({
                step: String(item.step || "").trim(),
                status:
                  item.status === "completed"
                    ? "completed"
                    : item.status === "in_progress"
                    ? "in_progress"
                    : "pending",
              }))
              .filter((item) => item.step.length > 0)
          : [];
        return plan.length > 0 ? plan : null;
      })
      .filter((item): item is Array<{ step: string; status: "pending" | "in_progress" | "completed" }> =>
        Boolean(item && item.length > 0)
      );
    const latestPlan = updatePlanSnapshots.length > 0 ? updatePlanSnapshots[updatePlanSnapshots.length - 1] : null;
    const effectivePlannedStepCount = latestPlan?.length || plannedStepCount;
    const latestCompletedCount = latestPlan
      ? latestPlan.filter((item) => item.status === "completed").length
      : 0;
    const latestPlanCount = latestPlan ? latestPlan.length : 0;

    if (hasSpawnAgentTool && plannedStepCount > 1 && !spawnedAgent) {
      const message =
        "Execution policy violated: confirmed multi-step plan must delegate at least one bounded task via spawn_agent.";
      if (enforceSpawnDelegationPolicy) {
        throw new Error(message);
      }
      console.warn("[plan-policy][spawn-agent-missing]", {
        plannedStepCount,
        spawnedAgent,
        hasSpawnAgentTool,
        enforced: false,
      });
    }
    if (!latestPlan) {
      const message =
        "Execution policy violated: execution finished without update_plan progress callbacks.";
      if (enforceUpdatePlanProgressPolicy) {
        throw new Error(message);
      }
      console.warn("[plan-policy][update-plan-missing]", {
        plannedStepCount,
        latestPlanCount,
        latestCompletedCount,
        enforced: false,
      });
    }
    if (effectivePlannedStepCount > 0 && latestPlan) {
      if (latestPlanCount < effectivePlannedStepCount || latestCompletedCount < effectivePlannedStepCount) {
        const message = `Execution policy violated: plan not fully completed (${latestCompletedCount}/${effectivePlannedStepCount}) via update_plan.`;
        if (enforceUpdatePlanProgressPolicy) {
          throw new Error(message);
        }
        console.warn("[plan-policy][update-plan-incomplete]", {
          plannedStepCount: effectivePlannedStepCount,
          latestPlanCount,
          latestCompletedCount,
          enforced: false,
        });
      }
    }
  }
  const durationSeconds = Number(((Date.now() - agentRuntimeStartAt) / 1000).toFixed(2));
  const finalPromptUsedTokens = await countGptMessagesTokens(runResult.completeMessages, tools).catch(() => 0);
  const finalCurrentInputTokens = Math.max(0, finalPromptUsedTokens - backgroundUsedTokens);
  const memoryRecallAudit = memoryRecall
    ? {
        files: memoryRecall.files.map((item) => item.path),
        indexTruncatedByLines: memoryRecall.index.truncatedByLines,
        indexTruncatedByBytes: memoryRecall.index.truncatedByBytes,
      }
    : undefined;
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
    contextManagement: {
      ...contextManaged.meta,
      finalPromptTokens: finalPromptUsedTokens,
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
      (entry): entry is {
        item: {
          type: "tool";
          id?: string;
          toolName?: string;
          params?: string;
          response?: string;
          interaction?: PlanInteractionEnvelope;
          progressStatus?: "pending" | "in_progress" | "completed" | "error";
        };
        index: number;
      } =>
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
  const toolDetailsFromFlow = stepResponses.map((node, index) => {
    const toolName = node.moduleName || "";
    const params = toStringValue(node.toolInput);
    const response = toStringValue(node.toolRes);
    return {
      id: pickTimelineToolId(toolName, params, response) || `${node.nodeId}-${index}`,
      toolName,
      params,
      response,
      interaction:
        node.toolRes && typeof node.toolRes === "object" && !Array.isArray(node.toolRes)
          ? isPlanInteractionEnvelope((node.toolRes as { interaction?: unknown }).interaction)
            ? (node.toolRes as { interaction: PlanInteractionEnvelope }).interaction
            : undefined
          : undefined,
    };
  });
  const latestPlanProgressInteraction = (() => {
    for (let i = stepResponses.length - 1; i >= 0; i -= 1) {
      const node = stepResponses[i];
      if (node.moduleName !== "update_plan") continue;
      const toolRes = node.toolRes;
      if (!toolRes || typeof toolRes !== "object" || Array.isArray(toolRes)) continue;
      const interactionValue = (toolRes as { interaction?: unknown }).interaction;
      if (!isPlanInteractionEnvelope(interactionValue) || interactionValue.type !== "plan_progress") continue;
      const payload = interactionValue.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
      const plan = Array.isArray((payload as { plan?: unknown }).plan)
        ? ((payload as { plan: unknown[] }).plan as unknown[])
            .filter((item): item is { step?: unknown; status?: unknown } => Boolean(item && typeof item === "object"))
            .map((item) => ({
              step: typeof item.step === "string" ? item.step.trim() : "",
              status:
                item.status === "completed"
                  ? ("completed" as const)
                  : item.status === "in_progress"
                  ? ("in_progress" as const)
                  : ("pending" as const),
            }))
            .filter((item) => item.step.length > 0)
        : [];
      if (plan.length === 0) continue;
      return {
        requestId: interactionValue.requestId,
        explanation:
          typeof (payload as { explanation?: unknown }).explanation === "string"
            ? (payload as { explanation: string }).explanation
            : undefined,
        plan,
      };
    }
    return null;
  })();
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
  let memoryUpdateAudit: ProjectMemoryUpdateResult | undefined;
  if (runtimeConfig.memoryEnabled && runtimeConfig.memoryAutoExtractEnabled) {
    memoryUpdateAudit = await extractAndPersistProjectMemories({
      projectToken: token,
      messages: [
        ...newMessages.map((item) => ({ role: item.role, content: item.content })),
        { role: "assistant", content: resolvedFinalMessage },
      ],
      llmExtract: runMemoryModelQuery,
    }).catch(() => ({ updated: false, writtenPaths: [] }));
  }

  if (stream) {
    sendSseEvent(res, SseResponseEventEnum.contextWindow, JSON.stringify(finalContextWindowUsage));
    sendSseEvent(
      res,
      SseResponseEventEnum.agentDuration,
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

    const existingAssistantMessage =
      continueAssistantMessageId && conversation
        ? conversation.messages.find(
            (item) => item.role === "assistant" && item.id === continueAssistantMessageId
          ) || null
        : null;

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
      const currentText = resolveAssistantContentForPersistence({
        generatedContent: current.content,
        resolvedFinalMessage,
        existingMessage: existingAssistantMessage,
      });
      const mergedKwargs = mergeAssistantAdditionalKwargs({
        existing: existingAssistantMessage?.additional_kwargs,
        incoming: {
          ...currentKwargs,
          planModeState: planModeActive,
          reasoning_text: finalReasoning,
          toolDetails: existingToolDetails.length > 0 ? existingToolDetails : toolDetailsFromFlow,
          ...(latestPlanProgressInteraction
            ? {
                planProgress: {
                  explanation: latestPlanProgressInteraction.explanation,
                  plan: latestPlanProgressInteraction.plan,
                },
              }
            : {}),
          ...(planModeActive && !planExecutionConfirmed && latestPlanProgressInteraction
            ? {
                planQuestions: [
                  {
                    requestId: `${latestPlanProgressInteraction.requestId}:execute`,
                    header: "执行确认",
                    id: "plan_execute_confirm",
                    question: "计划已生成，是否立即执行完整清单？",
                    options: [
                      { label: "确认执行", description: "按计划顺序开始执行并持续回写进度" },
                      { label: "继续调整", description: "保持计划模式，继续补充或修改计划" },
                    ],
                  },
                ],
              }
            : {}),
          ...(persistedTimeline.length > 0 ? { timeline: persistedTimeline } : {}),
          responseData: stepResponses,
          executionDelegationMode: spawnedAgent ? "subagent" : "direct",
          planModeProtocolVersion: 2,
          durationSeconds,
          contextWindow: finalContextWindowUsage,
          ...(memoryRecallAudit ? { memoryRecall: memoryRecallAudit } : {}),
          ...(memoryUpdateAudit ? { memoryUpdate: memoryUpdateAudit } : {}),
        },
      });
      assistantToStore = {
        type: "assistant",
        subtype: planModeActive ? "plan_result" : "result",
        ...current,
        ...(continueAssistantMessageId ? { id: continueAssistantMessageId } : {}),
        content: currentText,
        additional_kwargs: mergedKwargs,
      };
    } else if (resolvedFinalMessage) {
      const mergedKwargs = mergeAssistantAdditionalKwargs({
        existing: existingAssistantMessage?.additional_kwargs,
        incoming: {
          planModeState: planModeActive,
          reasoning_text: finalReasoning,
          toolDetails: toolDetailsFromFlow,
          ...(latestPlanProgressInteraction
            ? {
                planProgress: {
                  explanation: latestPlanProgressInteraction.explanation,
                  plan: latestPlanProgressInteraction.plan,
                },
              }
            : {}),
          ...(planModeActive && !planExecutionConfirmed && latestPlanProgressInteraction
            ? {
                planQuestions: [
                  {
                    requestId: `${latestPlanProgressInteraction.requestId}:execute`,
                    header: "执行确认",
                    id: "plan_execute_confirm",
                    question: "计划已生成，是否立即执行完整清单？",
                    options: [
                      { label: "确认执行", description: "按计划顺序开始执行并持续回写进度" },
                      { label: "继续调整", description: "保持计划模式，继续补充或修改计划" },
                    ],
                  },
                ],
              }
            : {}),
          ...(persistedTimeline.length > 0 ? { timeline: persistedTimeline } : {}),
          responseData: stepResponses,
          executionDelegationMode: spawnedAgent ? "subagent" : "direct",
          planModeProtocolVersion: 2,
          durationSeconds,
          contextWindow: finalContextWindowUsage,
          ...(memoryRecallAudit ? { memoryRecall: memoryRecallAudit } : {}),
          ...(memoryUpdateAudit ? { memoryUpdate: memoryUpdateAudit } : {}),
        },
      });
      assistantToStore = {
        type: "assistant",
        subtype: planModeActive ? "plan_result" : "result",
        role: "assistant",
        content: resolvedFinalMessage,
        id: continueAssistantMessageId || createDataId(),
        additional_kwargs: mergedKwargs,
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
      memoryRecall: memoryRecallAudit,
      memoryUpdate: memoryUpdateAudit,
      responseData: stepResponses,
      durationSeconds,
      choices: [
        {
          index: 0,
          message: {
            type: "assistant",
            subtype: planModeActive ? "plan_result" : "result",
            role: "assistant",
            content: resolvedFinalMessage,
          },
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
