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
import { runSimpleAgentWorkflow } from "@server/agent/workflow/simpleAgentWorkflow";
import { getChatModelCatalog } from "@server/aiProxy/catalogStore";
import { requireAuth } from "@server/auth/session";
import { toToolMemoryMessages } from "@server/chat/completions/toolMemory";
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
import { extractText } from "@shared/chat/messages";
import { SseResponseEventEnum } from "@shared/network/sseEvents";
import type { NextApiRequest, NextApiResponse } from "next";

type IncomingMessage = {
  role?: string;
  content?: unknown;
};
type SupportedRole = ConversationMessage["role"];
type TimelineItem = {
  type: "reasoning" | "answer" | "tool";
  text?: string;
  id?: string;
  toolName?: string;
  params?: string;
  response?: string;
};

const STUDIO_PROMPT = [
  "You are running in Skill Creator Studio.",
  "This studio is isolated from project files.",
  "Only edit files inside this workspace.",
  "Reference resolution rule: if user says 'this skill/这个 skill/当前 skill' without naming one, they mean the current workspace skill files, not the built-in skill named skill-creator.",
  "For that kind of question, inspect workspace files first (e.g. list_files + read_file for /<slug>/SKILL.md) and answer from those files.",
  "After reading the relevant SKILL.md once, provide a direct answer. Do not call read_file repeatedly for the same path in one reply unless the user explicitly asks for re-check.",
  "Skill workspace uses foldered root paths. Keep the main definition at /<slug>/SKILL.md.",
  "When creating or updating /<slug>/SKILL.md, always include YAML frontmatter at the top.",
  "The frontmatter must start and end with --- and include at least:",
  "name: <kebab-case-skill-name>",
  "description: <one-line-purpose-and-trigger>",
  "Optional fields: version, compatibility, license, metadata.",
  "The frontmatter name must match the intended skill slug.",
].join("\n");

const toMessages = (messages: unknown): ConversationMessage[] => {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((item) => {
      const msg = item as IncomingMessage;
      const role = msg?.role as SupportedRole | undefined;
      if (!role || !["user", "assistant", "system", "tool"].includes(role)) return null;
      const content =
        typeof msg.content === "string" ? msg.content : extractText(msg.content).trim();
      return {
        role,
        content: content || "",
        id: createDataId(),
      } as ConversationMessage;
    })
    .filter((item): item is ConversationMessage => Boolean(item));
};

const toAgentMessages = (messages: ConversationMessage[]): ChatCompletionMessageParam[] => {
  const output: ChatCompletionMessageParam[] = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      const toolMemoryMessages = toToolMemoryMessages(message);
      if (toolMemoryMessages.length > 0) {
        output.push(...toolMemoryMessages);
      }

      const assistantText = extractText(message.content).trim();
      if (assistantText) {
        output.push({
          role: "assistant",
          content: assistantText,
        } as ChatCompletionMessageParam);
      }
      continue;
    }

    output.push({
      role: message.role,
      content: extractText(message.content),
    } as ChatCompletionMessageParam);
  }

  return output;
};

const getConversationId = (req: NextApiRequest) =>
  typeof req.body?.conversation_id === "string"
    ? req.body.conversation_id
    : typeof req.body?.conversationId === "string"
    ? req.body.conversationId
    : undefined;
const getConversationToken = (req: NextApiRequest, projectToken: string, workspaceId: string) => {
  const bodyToken = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (bodyToken.startsWith("skill-studio:")) {
    return bodyToken;
  }
  const scope = projectToken || "global";
  return `skill-studio:${scope}:${workspaceId}`;
};
const getRunToken = (req: NextApiRequest, fallback: string) => {
  const bodyToken = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  return bodyToken || fallback;
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

const getWorkspaceId = (req: NextApiRequest) => {
  const fromBody = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "";
  if (fromBody) return fromBody;
  const fromQuery = req.query.workspaceId;
  if (Array.isArray(fromQuery)) return fromQuery[0] || "";
  return typeof fromQuery === "string" ? fromQuery : "";
};
const getProjectToken = (req: NextApiRequest) => {
  const fromBody = typeof req.body?.projectToken === "string" ? req.body.projectToken : "";
  if (fromBody) return fromBody;
  const fromQuery = req.query.projectToken;
  if (Array.isArray(fromQuery)) return fromQuery[0] || "";
  return typeof fromQuery === "string" ? fromQuery : "";
};
const getSkillId = (req: NextApiRequest) => {
  const fromBody = typeof req.body?.skillId === "string" ? req.body.skillId : "";
  if (fromBody) return fromBody;
  const fromQuery = req.query.skillId;
  if (Array.isArray(fromQuery)) return fromQuery[0] || "";
  return typeof fromQuery === "string" ? fromQuery : "";
};

const toSelectedSkills = (req: NextApiRequest) => {
  const fromArray = Array.isArray(req.body?.selectedSkills)
    ? (req.body.selectedSkills as unknown[])
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const fromSingle = typeof req.body?.selectedSkill === "string" ? req.body.selectedSkill.trim() : "";
  const merged = [...fromArray, ...(fromSingle ? [fromSingle] : [])];
  return Array.from(new Set(merged));
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
  const skillRunScriptTool =
    allAvailableSkills.length > 0
      ? await createSkillRunScriptTool({
          skills: allAvailableSkills,
          sessionId: toolSessionId,
          workspaceFiles: toWorkspacePublicFiles(workspace.files || {}),
        })
      : null;
  const bashTool = createBashTool({ sessionId: toolSessionId });
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
