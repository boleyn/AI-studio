import type { ChatCompletionMessageParam, ChatCompletionTool } from "@aistudio/ai/compat/global/core/ai/type";
import { countGptMessagesTokens } from "@aistudio/ai/compat/common/string/tiktoken/index";
import { getLLMModel } from "@aistudio/ai/model";
import { computedMaxToken } from "@aistudio/ai/utils";
import { createLLMResponse } from "@aistudio/ai/llm/request";
import { SKILL_STUDIO_AGENT_PROMPT } from "@server/agent/prompts/skillStudioAgentPrompt";
import { collectProjectRuntimeSkills } from "@server/agent/skills/projectRuntimeSkills";
import { getAgentRuntimeConfig } from "@server/agent/runtimeConfig";
import { buildSkillsCatalogPrompt } from "@server/agent/skills/prompt";
import { getRuntimeSkills } from "@server/agent/skills/registry";
import { createSkillLoadTool, createSkillRunScriptTool } from "@server/agent/skills/tool";
import { createBashTool } from "@server/agent/tools/bashTool";
import { createSkillWorkspaceTools } from "@server/agent/tools/skillWorkspaceTools";
import type { AgentToolDefinition } from "@server/agent/tools/types";
import { ProjectWorkspaceManager } from "@server/agent/workspace/projectWorkspaceManager";
import { runSimpleAgentWorkflow } from "@server/agent/workflow/simpleAgentWorkflow";
import { getChatModelCatalog, getChatModelProfile, runWithRequestModelProfiles } from "@server/aiProxy/catalogStore";
import { requireAuth } from "@server/auth/session";
import { getUserModelConfigsFromUser, toUserModelProfileMap } from "@server/auth/userModelConfig";
import {
  appendConversationMessages,
  getConversation,
  type ConversationMessage,
} from "@server/conversations/conversationStorage";
import {
  registerActiveConversationRun,
  unregisterActiveConversationRun,
} from "@server/chat/activeRuns";
import { bindWorkflowAbortToConnection } from "@server/chat/completions/connectionLifecycle";
import { getSkillWorkspace } from "@server/skills/workspaceStorage";
import { toWorkspacePublicFiles } from "@server/skills/workspaceStorage";
import { createDataId } from "@shared/chat/ids";
import { SseResponseEventEnum } from "@shared/network/sseEvents";
import type { NextApiRequest, NextApiResponse } from "next";
import { assemblePrompts } from "@server/chat/completions/promptAssembler";
import { manageContextWindow } from "@server/chat/completions/contextManager";
import {
  buildProjectMemoryContextPrompt,
  extractAndPersistProjectMemories,
  getProjectMemoryBehaviorPrompt,
  recallProjectMemoriesWithModel,
  type ProjectMemoryRecall,
  type ProjectMemoryUpdateResult,
} from "@server/chat/completions/projectMemory";
import {
  getConversationId,
  getConversationToken,
  getProjectToken,
  getRunToken,
  getSkillId,
  getWorkspaceId,
  sendSseEvent,
  startSse,
  startSseHeartbeat,
  STUDIO_PROMPT,
  TimelineItem,
  toAgentMessages,
  toMessages,
  toSelectedSkills,
  toStringValue,
  normalizeToolChoiceMode,
} from "./completions/helpers";

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

  const workspaceId = getWorkspaceId(req).trim();
  const projectToken = getProjectToken(req).trim();
  const skillId = getSkillId(req).trim();
  const resolvedWorkspaceId = workspaceId || skillId || projectToken;
  if (!resolvedWorkspaceId) {
    res.status(400).json({ error: "缺少 workspaceId/skillId/projectToken" });
    return;
  }

  let workspace: Awaited<ReturnType<typeof getSkillWorkspace>>;
  try {
    workspace = await getSkillWorkspace(
      resolvedWorkspaceId,
      userId,
      projectToken || undefined,
      skillId || undefined
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "workspace 不可用";
    res.status(403).json({ error: message });
    return;
  }

  const incomingMessages = toMessages(req.body?.messages);
  if (incomingMessages.length === 0) {
    res.status(400).json({ error: "缺少 messages" });
    return;
  }
  const stream = req.body?.stream !== false;
  const persistIncomingMessages = req.body?.persistIncomingMessages !== false;
  const conversationId = getConversationId(req);
  const conversationToken = getConversationToken(
    req,
    workspace.projectToken || projectToken,
    workspace.id
  );
  const runToken = getRunToken(req, conversationToken);
  const created = Math.floor(Date.now() / 1000);
  const model = typeof req.body?.model === "string" ? req.body.model : "agent";
  const userModelConfigs = getUserModelConfigsFromUser(auth.user);
  const userModelProfiles = toUserModelProfileMap(userModelConfigs);
  let streamStarted = false;
  let stopStreamHeartbeat = () => {};
  const startStream = () => {
    if (streamStarted) return;
    startSse(res);
    stopStreamHeartbeat = startSseHeartbeat(res);
    streamStarted = true;
  };
  const emitAnswerChunk = (selectedModel: string, text: string, reasoningText?: string) => {
    const delta: Record<string, string> = {};
    if (text) delta.content = text;
    if (reasoningText) delta.reasoning_content = reasoningText;
    sendSseEvent(
      res,
      SseResponseEventEnum.answer,
      JSON.stringify({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        created,
        model: selectedModel || model,
        choices: [
          {
            index: 0,
            delta,
            finish_reason: null,
          },
        ],
      })
    );
  };

  const runtimeConfig = getAgentRuntimeConfig();
  if (!runtimeConfig.apiKey) {
    res.status(400).json({ error: "缺少 AIPROXY_API_TOKEN/CHAT_API_KEY，无法调用模型。" });
    return;
  }

  const runtimeSkills = await getRuntimeSkills();
  const projectSkillsParsed =
    workspace.source === "project" && workspace.projectToken
      ? collectProjectRuntimeSkills(workspace.files || {}, `project:${workspace.projectToken}`)
      : { entries: [], skills: [], duplicateNames: {} };
  const mergedSkillByName = new Map<string, (typeof runtimeSkills)[number]>();
  for (const skill of runtimeSkills) mergedSkillByName.set(skill.name, skill);
  for (const skill of projectSkillsParsed.skills) mergedSkillByName.set(skill.name, skill);
  const allAvailableSkills = [...mergedSkillByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const selectedSkillsInput = toSelectedSkills(req);
  const selectedResolvedSkills = selectedSkillsInput
    .map((requestedName) =>
      allAvailableSkills.find(
        (item) => item.name === requestedName || item.name.toLowerCase() === requestedName.toLowerCase()
      )
    )
    .filter((item): item is (typeof runtimeSkills)[number] => Boolean(item));
  const selectedRuntimeSkills = selectedResolvedSkills.filter((item) =>
    runtimeSkills.some((runtimeSkill) => runtimeSkill.name === item.name)
  );
  const selectedProjectSkills = selectedResolvedSkills.filter(
    (item) => !runtimeSkills.some((runtimeSkill) => runtimeSkill.name === item.name)
  );
  const historyConversationMessages = conversationId
    ? (await getConversation(conversationToken, conversationId))?.messages ?? []
    : [];
  const newConversationMessages = incomingMessages;
  const contextConversationMessages: ConversationMessage[] = [
    ...historyConversationMessages,
    ...newConversationMessages,
  ];
  const historyOnlyConversationMessages: ConversationMessage[] = [...historyConversationMessages];
  const contextMessages: ChatCompletionMessageParam[] = toAgentMessages(contextConversationMessages);
  const historyOnlyMessages: ChatCompletionMessageParam[] = toAgentMessages(historyOnlyConversationMessages);
  const workspaceTools = createSkillWorkspaceTools({
    workspaceId: workspace.id,
    userId,
    projectToken: workspace.projectToken,
    skillId: workspace.skillId,
    historyMessages: contextConversationMessages,
  });
  const skillLoadTool = allAvailableSkills.length > 0 ? await createSkillLoadTool({ skills: allAvailableSkills }) : null;
  const toolSessionId = conversationId || `skill-${workspace.id}-${userId}`;
  const projectWorkspaceManager = new ProjectWorkspaceManager({
    sessionId: toolSessionId,
    fallbackProjectToken: workspace.projectToken,
  });
  const skillRunScriptTool =
    allAvailableSkills.length > 0
      ? await createSkillRunScriptTool({
          skills: allAvailableSkills,
          sessionId: toolSessionId,
          workspaceFiles: toWorkspacePublicFiles(workspace.files || {}),
          workspaceManager: projectWorkspaceManager,
          projectToken: workspace.projectToken,
        })
      : null;
  const bashTool = createBashTool({
    sessionId: toolSessionId,
    workspaceManager: projectWorkspaceManager,
    fallbackProjectToken: workspace.projectToken,
    allowedProjectToken: workspace.projectToken,
  });
  const allTools: AgentToolDefinition[] = [
    ...workspaceTools,
    ...(skillLoadTool ? [skillLoadTool] : []),
    ...(skillRunScriptTool ? [skillRunScriptTool] : []),
    bashTool,
  ];

  const tools: ChatCompletionTool[] = allTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  const modelCatalogKey =
    typeof req.body?.modelCatalogKey === "string" ? req.body.modelCatalogKey : undefined;
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
  const available = new Set(combinedCatalogModels.map((item) => item.id));
  const selectedModel =
    explicitRequestedModel && available.has(explicitRequestedModel)
      ? explicitRequestedModel
      : available.has(requestedModel)
      ? requestedModel
      : available.has(catalog.defaultModel)
      ? catalog.defaultModel
      : combinedCatalogModels[0]?.id || requestedModel;
  const selectedModelProfile = userModelProfiles.get(selectedModel) || getChatModelProfile(selectedModel, modelCatalogKey);
  const profileToolChoiceMode = normalizeToolChoiceMode(
    selectedModelProfile?.toolChoiceMode ??
      selectedModelProfile?.toolChoice ??
      selectedModelProfile?.forceToolChoice
  );
  const isGoogleModel = selectedModel.trim().toLowerCase().startsWith("google");
  const omitToolChoice =
    isGoogleModel ||
    (requestedToolChoiceMode as any) === "none" ||
    (profileToolChoiceMode as any) === "none";
  const toolChoiceForWorkflow: "auto" | "required" | undefined = omitToolChoice
    ? undefined
    : requestedToolChoiceMode === "auto" || requestedToolChoiceMode === "required"
      ? requestedToolChoiceMode
      : profileToolChoiceMode === "auto" || profileToolChoiceMode === "required"
        ? profileToolChoiceMode
        : "auto";

  const skillsCatalogPrompt =
    allAvailableSkills.length > 0 ? buildSkillsCatalogPrompt(allAvailableSkills) : "";
  const selectedSkillsPrompt =
    selectedResolvedSkills.length > 0
      ? [
          "User selected the following skills for this task:",
          ...selectedResolvedSkills.map((item) => `- ${item.name}`),
          ...(selectedRuntimeSkills.length > 0
            ? [
                'You may call tool "skill_load" for runtime skills when full instructions are needed; do not force tool calls if the task is already clear.',
                "Reason first, then decide whether loading each skill is necessary.",
              ]
            : []),
          ...(selectedProjectSkills.length > 0
            ? ["Project-bound selected skills are preloaded below. Follow them as mandatory instructions."]
            : []),
        ].join("\n")
      : "";
  const latestSkillUserText = (() => {
    for (let i = contextConversationMessages.length - 1; i >= 0; i -= 1) {
      if (contextConversationMessages[i].role !== "user") continue;
      return String(contextConversationMessages[i].content || "");
    }
    return "";
  })();
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
  const systemMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: SKILL_STUDIO_AGENT_PROMPT },
    { role: "system", content: STUDIO_PROMPT },
    ...(skillsCatalogPrompt
      ? [{ role: "system", content: skillsCatalogPrompt } as ChatCompletionMessageParam]
      : []),
    ...(selectedSkillsPrompt
      ? [{ role: "system", content: selectedSkillsPrompt } as ChatCompletionMessageParam]
      : []),
    ...selectedProjectSkills.map(
      (item) =>
        ({
          role: "system",
          content: [`Loaded project skill: ${item.name}`, item.body].join("\n\n"),
        } as ChatCompletionMessageParam)
    ),
  ];
  const memoryRecall: ProjectMemoryRecall | null =
    runtimeConfig.memoryEnabled && workspace.projectToken
      ? await recallProjectMemoriesWithModel({
          projectToken: workspace.projectToken,
          query: latestSkillUserText,
          llmSelect: runMemoryModelQuery,
        }).catch(() => null)
      : null;
  const memoryContextPrompt = memoryRecall ? buildProjectMemoryContextPrompt(memoryRecall) : "";
  const memoryPrompts: ChatCompletionMessageParam[] =
    runtimeConfig.memoryEnabled && workspace.projectToken
      ? [
          { role: "system", content: getProjectMemoryBehaviorPrompt() } as ChatCompletionMessageParam,
          ...(memoryContextPrompt
            ? [{ role: "system", content: memoryContextPrompt } as ChatCompletionMessageParam]
            : []),
        ]
      : [];
  const assembled = assemblePrompts({
    coreSystemPrompts: systemMessages,
    contextMessages,
    memoryPrompts,
  });
  const backgroundAssembled = assemblePrompts({
    coreSystemPrompts: systemMessages,
    contextMessages: historyOnlyMessages,
    memoryPrompts,
  });
  let messages: ChatCompletionMessageParam[] = assembled.messages;
  const backgroundMessages: ChatCompletionMessageParam[] = backgroundAssembled.messages;
  const selectedModelInfo = await runWithRequestModelProfiles(userModelProfiles, async () => getLLMModel(selectedModel));
  const contextManaged = await manageContextWindow({
    messages,
    tools,
    model: selectedModelInfo,
    focusQuery: latestSkillUserText,
    enabled: runtimeConfig.contextManagerEnabled,
  });
  messages = contextManaged.messages;
  const promptUsedTokens = await countGptMessagesTokens(messages, tools).catch(() => 0);
  const backgroundUsedTokens = await countGptMessagesTokens(backgroundMessages, tools).catch(() => 0);
  const systemAndSkillsTokens = await countGptMessagesTokens(assembled.systemPrompts).catch(() => 0);
  const historyTokens = await countGptMessagesTokens(historyOnlyMessages).catch(() => 0);
  const toolsSchemaTokens = await countGptMessagesTokens([], tools).catch(() => 0);
  const reservedOutputTokens = computedMaxToken({
    model: selectedModelInfo,
    min: 100,
  });
  const promptMaxContext = Math.max(1, selectedModelInfo.maxContext || 16000);
  const promptUsedPercent = Math.min(100, Math.max(0, (backgroundUsedTokens / promptMaxContext) * 100));
  const currentInputTokens = Math.max(0, promptUsedTokens - backgroundUsedTokens);
  const contextWindowUsage = {
    model: selectedModel,
    totalPromptTokens: promptUsedTokens,
    currentInputTokens,
    usedTokens: backgroundUsedTokens,
    maxContext: promptMaxContext,
    remainingTokens: Math.max(0, promptMaxContext - backgroundUsedTokens),
    usedPercent: Number(promptUsedPercent.toFixed(2)),
    budget: {
      systemAndSkillsTokens,
      historyTokens,
      historyFileTokens: 0,
      toolsSchemaTokens,
      backgroundTokens: backgroundUsedTokens,
      currentInputTokens,
      totalPromptTokens: promptUsedTokens,
      reservedOutputTokens,
    },
    contextManagement: contextManaged.meta,
  };

  try {
    if (stream) {
      startStream();
      sendSseEvent(res, SseResponseEventEnum.contextWindow, JSON.stringify(contextWindowUsage));
    }
    const workflowStartAt = Date.now();
    const workflowAbortController = new AbortController();
    const cleanupDisconnectBinding = bindWorkflowAbortToConnection({
      req,
      res,
      controller: workflowAbortController,
      scope: "skills/chat/completions",
    });
    if (conversationId) {
      registerActiveConversationRun({
        token: runToken,
        chatId: conversationId,
        controller: workflowAbortController,
      });
    }
    const timeline: TimelineItem[] = [];
    const toolTimelineIndex = new Map<string, number>();
    const appendTimelineText = (type: "reasoning" | "answer", text: string) => {
      if (!text) return;
      const last = timeline[timeline.length - 1];
      if (last && last.type === type && !last.id) {
        last.text = `${last.text || ""}${text}`;
        return;
      }
      timeline.push({ type, text });
    };
    const upsertToolTimeline = (input: {
      id?: string;
      toolName?: string;
      params?: string;
      response?: string;
    }) => {
      const toolId = input.id || "";
      const hasExisting = toolId ? toolTimelineIndex.has(toolId) : false;
      if (hasExisting) {
        const index = toolTimelineIndex.get(toolId) as number;
        const current = timeline[index];
        if (!current || current.type !== "tool") return;
        current.toolName = input.toolName ?? current.toolName;
        current.params = input.params ?? current.params;
        current.response = input.response ?? current.response;
        return;
      }
      const item: TimelineItem = {
        type: "tool",
        id: input.id,
        toolName: input.toolName,
        params: input.params || "",
        response: input.response || "",
      };
      timeline.push(item);
      if (toolId) {
        toolTimelineIndex.set(toolId, timeline.length - 1);
      }
    };

    const result = await (async () => {
      try {
        return await runWithRequestModelProfiles(userModelProfiles, async () =>
          runSimpleAgentWorkflow({
            selectedModel,
            stream,
            recursionLimit: runtimeConfig.recursionLimit || 6,
            temperature: runtimeConfig.temperature,
            userKey: (() => {
              const profile = userModelProfiles.get(selectedModel);
              const baseUrl = typeof profile?.baseUrl === "string" ? profile.baseUrl.trim() : undefined;
              const key = typeof profile?.key === "string" ? profile.key.trim() : undefined;
              return baseUrl || key ? { baseUrl, key } : undefined;
            })(),
            thinking,
            messages,
            toolChoice: toolChoiceForWorkflow,
            allTools,
            tools,
            abortSignal: workflowAbortController.signal,
            onEvent: (event, data) => {
              if (!stream) return;
              if (event === SseResponseEventEnum.answer) {
                const text = typeof data.text === "string" ? data.text : "";
                if (text) {
                  appendTimelineText("answer", text);
                  emitAnswerChunk(selectedModel, text);
                }
                return;
              }
              if (event === SseResponseEventEnum.reasoning) {
                const text = typeof data.text === "string" ? data.text : "";
                if (text) {
                  appendTimelineText("reasoning", text);
                  emitAnswerChunk(selectedModel, "", text);
                }
                return;
              }
              if (event === SseResponseEventEnum.toolCall) {
                upsertToolTimeline({
                  id: typeof data.id === "string" ? data.id : undefined,
                  toolName: typeof data.toolName === "string" ? data.toolName : undefined,
                });
                sendSseEvent(res, event, JSON.stringify(data));
                return;
              }
              if (event === SseResponseEventEnum.toolParams) {
                upsertToolTimeline({
                  id: typeof data.id === "string" ? data.id : undefined,
                  toolName: typeof data.toolName === "string" ? data.toolName : undefined,
                  params: typeof data.params === "string" ? data.params : undefined,
                });
                sendSseEvent(res, event, JSON.stringify(data));
                return;
              }
              if (event === SseResponseEventEnum.toolResponse) {
                upsertToolTimeline({
                  id: typeof data.id === "string" ? data.id : undefined,
                  toolName: typeof data.toolName === "string" ? data.toolName : undefined,
                  params: typeof data.params === "string" ? data.params : undefined,
                  response: typeof data.response === "string" ? data.response : undefined,
                });
                sendSseEvent(res, event, JSON.stringify(data));
                return;
              }
              sendSseEvent(res, event, JSON.stringify(data));
            },
          })
        );
      } finally {
        cleanupDisconnectBinding();
        if (conversationId) {
          unregisterActiveConversationRun({
            token: runToken,
            chatId: conversationId,
            controller: workflowAbortController,
          });
        }
      }
    })();

    const durationSeconds = Number(((Date.now() - workflowStartAt) / 1000).toFixed(2));
    const memoryUpdateAudit: ProjectMemoryUpdateResult | undefined =
      runtimeConfig.memoryEnabled &&
      runtimeConfig.memoryAutoExtractEnabled &&
      workspace.projectToken
        ? await extractAndPersistProjectMemories({
            projectToken: workspace.projectToken,
            messages: [
              ...newConversationMessages.map((item) => ({ role: item.role, content: item.content })),
              { role: "assistant", content: result.finalMessage },
            ],
            llmExtract: runMemoryModelQuery,
          }).catch(() => ({ updated: false, writtenPaths: [] }))
        : undefined;
    if (persistIncomingMessages && conversationId && newConversationMessages.length > 0) {
      await appendConversationMessages(conversationToken, conversationId, newConversationMessages);
    }
    if (conversationId) {
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
      const timelineToolCandidates = timeline
        .map((item, index) => ({ item, index }))
        .filter(
          (entry): entry is { item: TimelineItem & { type: "tool" }; index: number } =>
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
      const toolDetails = result.flowResponses.map((node, index) => {
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
      await appendConversationMessages(conversationToken, conversationId, [
        {
          role: "assistant",
          content: result.finalMessage,
          id: createDataId(),
          additional_kwargs: {
            reasoning_text: result.finalReasoning,
            toolDetails,
            responseData: result.flowResponses,
            durationSeconds,
            timeline,
            contextWindow: contextWindowUsage,
            ...(memoryRecall
              ? {
                  memoryRecall: {
                    files: memoryRecall.files.map((item) => item.path),
                    indexTruncatedByLines: memoryRecall.index.truncatedByLines,
                    indexTruncatedByBytes: memoryRecall.index.truncatedByBytes,
                  },
                }
              : {}),
            ...(memoryUpdateAudit ? { memoryUpdate: memoryUpdateAudit } : {}),
          },
        },
      ]);
    }

    if (stream) {
      sendSseEvent(
        res,
        SseResponseEventEnum.workflowDuration,
        JSON.stringify({ durationSeconds })
      );
      sendSseEvent(
        res,
        SseResponseEventEnum.answer,
        JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion.chunk",
          created,
          model: selectedModel,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
        })
      );
      sendSseEvent(res, SseResponseEventEnum.answer, "[DONE]");
      stopStreamHeartbeat();
      res.end();
      return;
    }

    res.status(200).json({
      assistant: {
        role: "assistant",
        content: result.finalMessage,
        reasoning: result.finalReasoning,
      },
      contextWindow: contextWindowUsage,
      memoryRecall: memoryRecall
        ? {
            files: memoryRecall.files.map((item) => item.path),
            indexTruncatedByLines: memoryRecall.index.truncatedByLines,
            indexTruncatedByBytes: memoryRecall.index.truncatedByBytes,
          }
        : undefined,
      memoryUpdate: memoryUpdateAudit,
      toolResponses: result.flowResponses,
      files: workspace.files,
      workspaceId: workspace.id,
      model: selectedModel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "skill studio 请求失败";
    if (stream) {
      startStream();
      emitAnswerChunk(selectedModel, `请求失败: ${message}`);
      sendSseEvent(
        res,
        SseResponseEventEnum.answer,
        JSON.stringify({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion.chunk",
          created,
          model: selectedModel,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
        })
      );
      sendSseEvent(res, SseResponseEventEnum.answer, "[DONE]");
      stopStreamHeartbeat();
      res.end();
      return;
    }
    res.status(500).json({ error: message });
  }
}
