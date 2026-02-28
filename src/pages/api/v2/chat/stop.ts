
import { requireAuth } from "@server/auth/session";
import { stopActiveConversationRun } from "@server/chat/activeRuns";
import type { NextApiRequest, NextApiResponse } from "next";

const getToken = (req: NextApiRequest): string | null => {
  const queryToken = typeof req.query.token === "string" ? req.query.token : null;
  const bodyToken = typeof req.body?.token === "string" ? req.body.token : null;
  return queryToken ?? bodyToken;
};

const getChatId = (req: NextApiRequest): string | null => {
  const queryChatId =
    typeof req.query.chatId === "string"
      ? req.query.chatId
      : typeof req.query.conversationId === "string"
      ? req.query.conversationId
      : null;
  const bodyChatId =
    typeof req.body?.chatId === "string"
      ? req.body.chatId
      : typeof req.body?.conversationId === "string"
      ? req.body.conversationId
      : null;
  return queryChatId ?? bodyChatId;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ success: boolean; stopped: boolean } | { error: string }>
) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

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

  const stopped = stopActiveConversationRun({ token, chatId });
  res.status(200).json({ success: true, stopped });
}

