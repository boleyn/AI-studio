import type { NextApiRequest, NextApiResponse } from "next";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getAgentRuntimeConfig } from "@/agent/app/config";
import { createAgentModelClient, type AgentModelConnection } from "@/agent/app/modelClient";
import {
  getConfiguredContextWindow,
  resolveModelConnection,
} from "@/agent/gateway/modelConnection";
import { getChatModelCatalog, getChatModelProfile } from "@server/aiProxy/catalogStore";
import { requireAuth } from "@server/auth/session";
import { getUserModelConfigsFromUser } from "@server/auth/userModelConfig";
import { bindAgentAbortToConnection } from "@server/chat/completions/agentConnectionLifecycle";
import { getChatTokenAccessState } from "@server/chat/tokenAccess";
import { getConversation } from "@server/conversations/conversationStorage";
import { getSideChat, upsertSideChat } from "@server/conversations/sideChatStorage";
import { sendSseEvent, startSse, startSseHeartbeat } from "@server/http/sse";
import { createDataId } from "@shared/chat/ids";
import { extractText } from "@shared/chat/messages";
import type { SideChatMessage } from "@features/chat/types/selectionChat";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "2mb",
    },
    responseLimit: false,
  },
};

const MAX_MAIN_CONTEXT_CHARS = 12000;
const MAX_MAIN_TURNS = 12;

const buildMainConversationSummary = (
  messages: Array<{ role?: string; content?: unknown; id?: string }>
): string => {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const recent = messages
    .filter((msg) => msg.role === "user" || msg.role === "assistant")
    .slice(-MAX_MAIN_TURNS);

  const lines: string[] = [];
  let total = 0;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const msg = recent[i];
    const text = extractText(msg.content).trim();
    if (!text) continue;
    const roleLabel = msg.role === "user" ? "用户" : "助手";
    const entry = `[${roleLabel}]: ${text.length > 2400 ? `${text.slice(0, 2400)}...` : text}`;
    if (total + entry.length > MAX_MAIN_CONTEXT_CHARS && lines.length > 0) break;
    lines.unshift(entry);
    total += entry.length;
  }
  return lines.join("\n\n");
};

const buildSideChatSystemPrompt = ({
  quoteText,
  mainContext,
}: {
  quoteText: string;
  mainContext: string;
}): string => {
  const parts: string[] = [
    "你正在一个「侧边聊天（Side Chat）」窗口中协助用户。这是用户从主对话中选中某段内容后发起的独立子讨论，不会打断或污染主对话。",
    "你的任务：紧密围绕用户选中的引用片段，结合主对话背景，直接、清晰、有条理地回答用户在侧边聊天中的提问。优先使用与用户相同的语言回复。",
  ];

  if (quoteText.trim()) {
    parts.push(`【用户选中的核心引用片段】\n"""\n${quoteText.trim()}\n"""`);
  }

  if (mainContext.trim()) {
    parts.push(`【主对话近期背景参考】\n${mainContext.trim()}`);
  }

  return parts.join("\n\n");
};

const normalizeIncomingMessages = (raw: unknown): SideChatMessage[] => {
  if (!Array.isArray(raw)) return [];
  const result: SideChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const role = record.role === "user" || record.role === "assistant" ? record.role : null;
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (!role || !content) continue;
    result.push({
      id:
        typeof record.id === "string" && record.id.trim()
          ? record.id.trim()
          : createDataId(),
      role,
      content,
      createdAt:
        typeof record.createdAt === "string" && record.createdAt.trim()
          ? record.createdAt.trim()
          : new Date().toISOString(),
    });
  }
  return result;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const token =
    (typeof req.headers["x-project-token"] === "string"
      ? req.headers["x-project-token"].trim()
      : "") ||
    (typeof req.body?.token === "string" ? req.body.token.trim() : "");

  if (!token) {
    res.status(400).json({ error: "缺少 token" });
    return;
  }

  const access = await getChatTokenAccessState(token, String(auth.user._id));
  if (access === "not_found") {
    res.status(404).json({ error: "项目或技能不存在" });
    return;
  }
  if (access === "forbidden") {
    res.status(403).json({ error: "无权访问该项目或技能" });
    return;
  }

  const conversationId =
    typeof req.body?.conversationId === "string"
      ? req.body.conversationId.trim()
      : typeof req.body?.conversation_id === "string"
      ? req.body.conversation_id.trim()
      : "";
  const threadId =
    typeof req.body?.threadId === "string" && req.body.threadId.trim()
      ? req.body.threadId.trim()
      : createDataId();
  const sourceMessageId =
    typeof req.body?.sourceMessageId === "string" && req.body.sourceMessageId.trim()
      ? req.body.sourceMessageId.trim()
      : undefined;
  const quoteText =
    typeof req.body?.quoteText === "string" ? req.body.quoteText.trim() : "";
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";

  if (!prompt) {
    res.status(400).json({ error: "缺少提问内容" });
    return;
  }

  const selectedModel =
    typeof req.body?.model === "string" && req.body.model.trim()
      ? req.body.model.trim()
      : getAgentRuntimeConfig().toolCallModel;
  const channel = typeof req.body?.channel === "string" ? req.body.channel.trim() : "";
  const customModel =
    channel === "user" || !channel
      ? getUserModelConfigsFromUser(auth.user).find((entry) => entry.id === selectedModel)
      : undefined;

  let modelConnection: AgentModelConnection | undefined;
  if (channel === "user" && !customModel) {
    res.status(400).json({ error: "所选的用户模型不存在，请重新选择。" });
    return;
  }
  if (customModel) {
    const protocol = (customModel.protocol || "openai").toLowerCase();
    if (protocol !== "openai" && protocol !== "anthropic" && protocol !== "google") {
      res.status(400).json({ error: "模型配置使用了不支持的协议。" });
      return;
    }
    try {
      const endpoint = new URL(customModel.baseUrl || "");
      if (
        !["http:", "https:"].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash ||
        !customModel.key
      ) {
        throw new Error("Invalid model connection");
      }
      modelConnection = {
        protocol,
        baseURL: endpoint.href.replace(/\/$/, ""),
        apiKey: customModel.key,
        maxContext: customModel.maxContext,
        maxTemperature: customModel.maxTemperature,
        reasoning: customModel.reasoning,
        vision: customModel.vision,
      };
    } catch {
      res.status(400).json({ error: "请在模型配置中填写有效的 Base URL 和 API Key。" });
      return;
    }
  } else {
    await getChatModelCatalog().catch(() => undefined);
    const systemProfile = getChatModelProfile(selectedModel) as
      | {
          protocol?: string;
          baseUrl?: string;
          key?: string;
          maxContext?: number;
          maxTemperature?: number;
          reasoning?: boolean;
          vision?: boolean;
        }
      | undefined;
    if (systemProfile?.baseUrl) {
      const protocolRaw = (systemProfile.protocol || "openai").toLowerCase();
      const protocol =
        protocolRaw === "anthropic" || protocolRaw === "google" ? protocolRaw : "openai";
      const apiKey = systemProfile.key || getAgentRuntimeConfig().apiKey || "";
      try {
        const endpoint = new URL(systemProfile.baseUrl);
        if (["http:", "https:"].includes(endpoint.protocol) && apiKey) {
          modelConnection = {
            protocol,
            baseURL: endpoint.href.replace(/\/$/, ""),
            apiKey,
            maxContext: systemProfile.maxContext,
            maxTemperature: systemProfile.maxTemperature,
            reasoning: systemProfile.reasoning,
            vision: systemProfile.vision,
          };
        }
      } catch {
        // fall back to resolveModelConnection
      }
    }
  }

  const resolvedConnection = await resolveModelConnection(selectedModel, modelConnection).catch(
    (error) => {
      res.status(400).json({
        error: error instanceof Error ? error.message : "模型连接配置无效",
      });
      return null;
    }
  );
  if (resolvedConnection === null) return;

  // Load main conversation context & existing side thread history if persisted
  const [mainConversation, persistedThread] = await Promise.all([
    conversationId ? getConversation(token, conversationId).catch(() => null) : Promise.resolve(null),
    conversationId
      ? getSideChat(token, conversationId, threadId).catch(() => null)
      : Promise.resolve(null),
  ]);

  const effectiveQuoteText = quoteText || persistedThread?.quoteText || "";
  const effectiveSourceMessageId = sourceMessageId || persistedThread?.sourceMessageId;
  const incomingHistory = normalizeIncomingMessages(req.body?.messages);
  const existingMessages: SideChatMessage[] =
    persistedThread && persistedThread.messages.length > 0
      ? persistedThread.messages
      : incomingHistory;

  const userMessage: SideChatMessage = {
    id:
      typeof req.body?.userMessageId === "string" && req.body.userMessageId.trim()
        ? req.body.userMessageId.trim()
        : createDataId(),
    role: "user",
    content: prompt,
    createdAt: new Date().toISOString(),
  };

  const mainContext = buildMainConversationSummary(mainConversation?.messages || []);
  const systemPrompt = buildSideChatSystemPrompt({
    quoteText: effectiveQuoteText,
    mainContext,
  });

  const llmMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...existingMessages.map(
      (msg): ChatCompletionMessageParam => ({
        role: msg.role,
        content: msg.content,
      })
    ),
    { role: "user", content: prompt },
  ];

  startSse(res);
  const stopHeartbeat = startSseHeartbeat(res);
  const abortController = new AbortController();
  bindAgentAbortToConnection({
    req,
    res,
    controller: abortController,
    scope: `v2-side-chat:${token}:${conversationId || "ephemeral"}:${threadId}`,
  });

  const assistantMessageId = createDataId();
  let accumulatedText = "";

  try {
    const maxContext = resolvedConnection?.maxContext || getConfiguredContextWindow(selectedModel);
    const client = createAgentModelClient(selectedModel, maxContext, resolvedConnection);
    const stream = await client.stream(
      {
        model: selectedModel,
        messages: llmMessages,
        stream: true,
      },
      abortController.signal
    );

    for await (const chunk of stream) {
      if (abortController.signal.aborted) break;
      const choice = chunk.choices?.[0];
      const delta = choice?.delta as { content?: string | null } | undefined;
      const piece = typeof delta?.content === "string" ? delta.content : "";
      if (piece) {
        accumulatedText += piece;
        sendSseEvent(
          res,
          "delta",
          JSON.stringify({
            threadId,
            messageId: assistantMessageId,
            text: piece,
          })
        );
      }
    }

    const assistantMessage: SideChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: accumulatedText || "（未生成回复内容）",
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...existingMessages, userMessage, assistantMessage];

    let savedThread = null;
    if (conversationId && accumulatedText.trim()) {
      savedThread = await upsertSideChat({
        token,
        chatId: conversationId,
        threadId,
        sourceMessageId: effectiveSourceMessageId,
        quoteText: effectiveQuoteText,
        messages: nextMessages,
      }).catch((err) => {
        console.warn("[v2/side-completions] persist failed", err);
        return null;
      });
    }

    sendSseEvent(
      res,
      "done",
      JSON.stringify({
        threadId,
        messageId: assistantMessageId,
        thread: savedThread,
      })
    );
  } catch (error) {
    if (abortController.signal.aborted) {
      // Save partial reply if any
      if (conversationId && accumulatedText.trim()) {
        const partialAssistant: SideChatMessage = {
          id: assistantMessageId,
          role: "assistant",
          content: accumulatedText,
          createdAt: new Date().toISOString(),
        };
        await upsertSideChat({
          token,
          chatId: conversationId,
          threadId,
          sourceMessageId: effectiveSourceMessageId,
          quoteText: effectiveQuoteText,
          messages: [...existingMessages, userMessage, partialAssistant],
        }).catch(() => undefined);
      }
      sendSseEvent(res, "done", JSON.stringify({ threadId, aborted: true }));
    } else {
      sendSseEvent(
        res,
        "error",
        JSON.stringify({
          message: error instanceof Error ? error.message : String(error ?? "侧边聊天请求失败"),
        })
      );
    }
  } finally {
    stopHeartbeat();
    res.end();
  }
}
