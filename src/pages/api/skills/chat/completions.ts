import type { ChatCompletionMessageParam, ChatCompletionTool } from "@aistudio/ai/compat/global/core/ai/type";
import { BASE_CODING_AGENT_PROMPT } from "@server/agent/prompts/baseCodingAgentPrompt";
import { getAgentRuntimeConfig } from "@server/agent/runtimeConfig";
import { buildSkillsCatalogPrompt } from "@server/agent/skills/prompt";
import { getRuntimeSkills } from "@server/agent/skills/registry";
import { createSkillLoadTool } from "@server/agent/skills/tool";
import { createSkillWorkspaceTools } from "@server/agent/tools/skillWorkspaceTools";
import type { AgentToolDefinition } from "@server/agent/tools/types";
import { runSimpleAgentWorkflow } from "@server/agent/workflow/simpleAgentWorkflow";
import { getChatModelCatalog } from "@server/aiProxy/catalogStore";
import { requireAuth } from "@server/auth/session";
import {
  appendConversationMessages,
  getConversation,
  type ConversationMessage,
} from "@server/conversations/conversationStorage";
import { getSkillWorkspace, requireSkillWorkspace } from "@server/skills/workspaceStorage";
import { createId, extractText } from "@shared/chat/messages";
import { SseResponseEventEnum } from "@shared/network/sseEvents";
import type { NextApiRequest, NextApiResponse } from "next";

type IncomingMessage = {
  role?: string;
  content?: unknown;
};
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
  "When creating skills, write files under /skills/<skill-name>/SKILL.md.",
].join("\n");

const toMessages = (messages: unknown): ChatCompletionMessageParam[] => {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((item) => {
      const msg = item as IncomingMessage;
      const role = msg?.role;
      if (!role || !["user", "assistant", "system", "tool"].includes(role)) return null;
      const content =
        typeof msg.content === "string" ? msg.content : extractText(msg.content).trim();
      return {
        role,
        content: content || "",
      } as ChatCompletionMessageParam;
    })
    .filter((item): item is ChatCompletionMessageParam => Boolean(item));
};
const toConversationMessages = (messages: ChatCompletionMessageParam[]): ConversationMessage[] =>
  messages.map((message) => ({
    role: message.role,
    content: typeof message.content === "string" ? message.content : extractText(message.content),
    id: createId(),
  }));

const getConversationId = (req: NextApiRequest) =>
  typeof req.body?.conversation_id === "string"
    ? req.body.conversation_id
    : typeof req.body?.conversationId === "string"
    ? req.body.conversationId
    : undefined;

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
  if (!projectToken) {
    res.status(400).json({ error: "缺少 projectToken" });
    return;
  }
  const resolvedWorkspaceId = workspaceId || projectToken;

  try {
    await requireSkillWorkspace(resolvedWorkspaceId, userId, projectToken);
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
  const conversationToken = `skill-studio:${projectToken}:${resolvedWorkspaceId}`;
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

  const workspaceTools = createSkillWorkspaceTools(workspaceId);
  const runtimeSkills = await getRuntimeSkills();
  const selectedSkillsInput = toSelectedSkills(req);
  const selectedRuntimeSkills = selectedSkillsInput
    .map((requestedName) =>
      runtimeSkills.find(
        (item) =>
          item.name === requestedName ||
          item.name.toLowerCase() === requestedName.toLowerCase()
      )
    )
    .filter((item): item is (typeof runtimeSkills)[number] => Boolean(item));
  const skillLoadTool = runtimeSkills.length > 0 ? await createSkillLoadTool() : null;
  const allTools: AgentToolDefinition[] = [...workspaceTools, ...(skillLoadTool ? [skillLoadTool] : [])];

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
    runtimeSkills.length > 0 ? buildSkillsCatalogPrompt(runtimeSkills) : "";
  const selectedSkillsPrompt =
    selectedRuntimeSkills.length > 0
      ? [
          "User selected the following skills for this task:",
          ...selectedRuntimeSkills.map((item) => `- ${item.name}`),
          'Before executing the task, call tool "skill_load" for each selected skill (exact names), then follow those instructions.',
        ].join("\n")
      : "";
  const historyMessages = conversationId
    ? ((await getConversation(conversationToken, conversationId))?.messages ?? []).map((message) => ({
        role: message.role,
        content: extractText(message.content),
      }))
    : [];
  const newConversationMessages = toConversationMessages(incomingMessages);
  const contextMessages: ChatCompletionMessageParam[] = [...historyMessages, ...incomingMessages];
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: BASE_CODING_AGENT_PROMPT },
    { role: "system", content: STUDIO_PROMPT },
    ...(skillsCatalogPrompt
      ? [{ role: "system", content: skillsCatalogPrompt } as ChatCompletionMessageParam]
      : []),
    ...(selectedSkillsPrompt
      ? [{ role: "system", content: selectedSkillsPrompt } as ChatCompletionMessageParam]
      : []),
    ...contextMessages,
  ];

  try {
    if (stream) {
      startStream();
    }
    const workflowStartAt = Date.now();
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

    const result = await runSimpleAgentWorkflow({
      selectedModel,
      stream,
      recursionLimit: runtimeConfig.recursionLimit || 6,
      temperature: runtimeConfig.temperature,
      messages,
      toolChoice: tools.length > 0 ? "required" : "auto",
      allTools,
      tools,
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

    const workspace = await getSkillWorkspace(resolvedWorkspaceId, userId, projectToken);
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
          id: createId(),
          additional_kwargs: {
            reasoning_text: result.finalReasoning,
            toolDetails,
            responseData: result.flowResponses,
            durationSeconds,
            timeline,
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
      toolResponses: result.flowResponses,
      files: workspace.files,
      workspaceId,
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
