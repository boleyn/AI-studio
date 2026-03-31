import type { ChatCompletionMessageParam, ChatCompletionTool } from "@aistudio/ai/compat/global/core/ai/type";
import { countGptMessagesTokens } from "@aistudio/ai/compat/common/string/tiktoken/index";
import { getLLMModel } from "@aistudio/ai/model";
import { computedMaxToken } from "@aistudio/ai/utils";
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
import { getChatModelCatalog } from "@server/aiProxy/catalogStore";
import { requireAuth } from "@server/auth/session";
import {
  appendConversationMessages,
  getConversation,
  type ConversationMessage,
} from "@server/conversations/conversationStorage";
import {
  registerActiveConversationRun,
  unregisterActiveConversationRun,
} from "@server/chat/activeRuns";
import { getSkillWorkspace } from "@server/skills/workspaceStorage";
import { toWorkspacePublicFiles } from "@server/skills/workspaceStorage";
import { createDataId } from "@shared/chat/ids";
import { SseResponseEventEnum } from "@shared/network/sseEvents";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  getConversationId,
  getConversationToken,
  getProjectToken,
  getRunToken,
  getSkillId,
  getWorkspaceId,
  sendSseEvent,
  startSse,
  STUDIO_PROMPT,
  TimelineItem,
  toAgentMessages,
  toMessages,
  toSelectedSkills,
  toStringValue,
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
  const conversationId = getConversationId(req);
  const conversationToken = getConversationToken(
    req,
    workspace.projectToken || projectToken,
    workspace.id
  );
  const runToken = getRunToken(req, conversationToken);
  const created = Math.floor(Date.now() / 1000);
  const model = typeof req.body?.model === "string" ? req.body.model : "agent";
  let streamStarted = false;
  const startStream = () => {
    if (streamStarted) return;
    startSse(res);
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

  const workspaceTools = createSkillWorkspaceTools({
    workspaceId: workspace.id,
    userId,
    projectToken: workspace.projectToken,
    skillId: workspace.skillId,
  });
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
  const available = new Set(catalog.models.map((item) => item.id));
  const selectedModel =
    available.has(requestedModel)
      ? requestedModel
      : available.has(catalog.defaultModel)
      ? catalog.defaultModel
      : catalog.models[0]?.id || requestedModel;

  const skillsCatalogPrompt =
    allAvailableSkills.length > 0 ? buildSkillsCatalogPrompt(allAvailableSkills) : "";
  const selectedSkillsPrompt =
    selectedResolvedSkills.length > 0
      ? [
          "User selected the following skills for this task:",
          ...selectedResolvedSkills.map((item) => `- ${item.name}`),
          ...(selectedRuntimeSkills.length > 0
            ? [
                'Before executing the task, call tool "skill_load" for each runtime skill (exact names), then follow those instructions.',
              ]
            : []),
          ...(selectedProjectSkills.length > 0
            ? ["Project-bound selected skills are preloaded below. Follow them as mandatory instructions."]
            : []),
        ].join("\n")
      : "";
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
  const messages: ChatCompletionMessageParam[] = [
    ...systemMessages,
    ...contextMessages,
  ];
  const backgroundMessages: ChatCompletionMessageParam[] = [
    ...systemMessages,
    ...historyOnlyMessages,
  ];
  const selectedModelInfo = getLLMModel(selectedModel);
  const promptUsedTokens = await countGptMessagesTokens(messages, tools).catch(() => 0);
  const backgroundUsedTokens = await countGptMessagesTokens(backgroundMessages, tools).catch(() => 0);
  const systemAndSkillsTokens = await countGptMessagesTokens(systemMessages).catch(() => 0);
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
  };

  try {
    if (stream) {
      startStream();
      sendSseEvent(res, SseResponseEventEnum.contextWindow, JSON.stringify(contextWindowUsage));
    }
    const workflowStartAt = Date.now();
    const workflowAbortController = new AbortController();
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
        return await runSimpleAgentWorkflow({
          selectedModel,
          stream,
          recursionLimit: runtimeConfig.recursionLimit || 6,
          temperature: runtimeConfig.temperature,
          messages,
          toolChoice: "auto",
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
        });
      } finally {
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
    if (conversationId && newConversationMessages.length > 0) {
      await appendConversationMessages(conversationToken, conversationId, newConversationMessages);
    }
    if (conversationId) {
      const toolDetails = result.flowResponses.map((node, index) => ({
        id: `${node.nodeId}-${index}`,
        toolName: node.moduleName,
        params: toStringValue(node.toolInput),
        response: toStringValue(node.toolRes),
      }));
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
      res.end();
      return;
    }
    res.status(500).json({ error: message });
  }
}
