
import { requireAuth } from "@server/auth/session";
import {
  getConversation,
  replaceConversationMessages,
  updateConversation,
  type Conversation,
  type ConversationMessage,
} from "@server/conversations/conversationStorage";
import type { NextApiRequest, NextApiResponse } from "next";

const getToken = (req: NextApiRequest): string | null => {
  const queryToken = typeof req.query.token === "string" ? req.query.token : null;
  const bodyToken = typeof req.body?.token === "string" ? req.body.token : null;
  return queryToken ?? bodyToken;
};

const getChatId = (req: NextApiRequest): string | null => {
  const queryChatId = typeof req.query.chatId === "string" ? req.query.chatId : null;
  const bodyChatId = typeof req.body?.chatId === "string" ? req.body.chatId : null;
  return queryChatId ?? bodyChatId;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ history: Conversation } | { error: string }>
) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const token = getToken(req);
  if (!token) {
    res.status(400).json({ error: "缺少 token 参数" });
    return;
  }

  const chatId = getChatId(req);
  if (!chatId) {
    res.status(400).json({ error: "缺少 chatId 参数" });
    return;
  }

  if (req.method !== "POST" && req.method !== "PATCH" && req.method !== "PUT") {
    res.setHeader("Allow", ["POST", "PATCH", "PUT"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const hasMessages = Array.isArray(req.body?.messages);
  const messages = hasMessages ? (req.body.messages as ConversationMessage[]) : undefined;
  const title = typeof req.body?.title === "string" ? req.body.title : undefined;
  const customTitle = typeof req.body?.customTitle === "string" ? req.body.customTitle : undefined;
  const top = typeof req.body?.top === "boolean" ? req.body.top : undefined;

  if (messages) {
    await replaceConversationMessages(token, chatId, messages, title);
  } else {
    await updateConversation(token, chatId, { title, customTitle, top });
  }

  const history = await getConversation(token, chatId);
  if (!history) {
    res.status(404).json({ error: "对话不存在" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ history });
}
