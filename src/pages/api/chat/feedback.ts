import { requireAuth } from "@server/auth/session";
import { updateConversationMessageFeedback } from "@server/conversations/conversationStorage";
import type { NextApiRequest, NextApiResponse } from "next";

const getToken = (req: NextApiRequest): string | null => {
  const headerToken =
    typeof req.headers["x-project-token"] === "string"
      ? req.headers["x-project-token"]
      : null;
  const queryToken = typeof req.query.token === "string" ? req.query.token : null;
  const bodyToken = typeof req.body?.token === "string" ? req.body.token : null;
  return headerToken ?? bodyToken ?? queryToken;
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

  const conversationId =
    typeof req.body?.conversationId === "string"
      ? req.body.conversationId
      : typeof req.body?.chatId === "string"
      ? req.body.chatId
      : "";
  const messageId = typeof req.body?.messageId === "string" ? req.body.messageId : "";
  const feedbackRaw = req.body?.feedback;
  const feedback =
    feedbackRaw === "up" || feedbackRaw === "down" ? feedbackRaw : undefined;

  if (!conversationId || !messageId) {
    res.status(400).json({ error: "缺少 conversationId 或 messageId" });
    return;
  }

  const success = await updateConversationMessageFeedback({
    token,
    chatId: conversationId,
    messageId,
    feedback,
  });

  if (!success) {
    res.status(404).json({ error: "消息不存在或更新失败" });
    return;
  }

  res.status(200).json({ success: true });
}
