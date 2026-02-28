
import { requireAuth } from "@server/auth/session";
import { deleteConversation } from "@server/conversations/conversationStorage";
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
  res: NextApiResponse<{ success: boolean } | { error: string }>
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

  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", ["POST", "DELETE"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const success = await deleteConversation(token, chatId);
  if (!success) {
    res.status(404).json({ error: "对话不存在" });
    return;
  }

  res.status(200).json({ success: true });
}
