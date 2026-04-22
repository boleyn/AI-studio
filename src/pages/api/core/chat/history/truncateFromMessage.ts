import { requireAuth } from "@server/auth/session";
import {
  truncateConversationAfterMessageId,
  truncateConversationFromMessageId,
} from "@server/conversations/conversationStorage";
import { getChatTokenAccessState } from "@server/chat/tokenAccess";
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

const getMessageId = (req: NextApiRequest): string | null => {
  const queryMessageId = typeof req.query.messageId === "string" ? req.query.messageId : null;
  const bodyMessageId = typeof req.body?.messageId === "string" ? req.body.messageId : null;
  return queryMessageId ?? bodyMessageId;
};

const getAfterMessageId = (req: NextApiRequest): string | null => {
  const queryMessageId = typeof req.query.afterMessageId === "string" ? req.query.afterMessageId : null;
  const bodyMessageId = typeof req.body?.afterMessageId === "string" ? req.body.afterMessageId : null;
  return queryMessageId ?? bodyMessageId;
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
  const access = await getChatTokenAccessState(token, String(auth.user._id));
  if (access === "not_found") {
    res.status(404).json({ error: "项目或技能不存在" });
    return;
  }
  if (access === "forbidden") {
    res.status(403).json({ error: "无权访问该项目或技能" });
    return;
  }

  const chatId = getChatId(req);
  if (!chatId) {
    res.status(400).json({ error: "缺少 chatId 参数" });
    return;
  }
  const messageId = getMessageId(req)?.trim();
  if (!messageId) {
    res.status(400).json({ error: "缺少 messageId 参数" });
    return;
  }
  const afterMessageId = getAfterMessageId(req)?.trim();

  if (req.method !== "POST" && req.method !== "PATCH") {
    res.setHeader("Allow", ["POST", "PATCH"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const success =
    (await truncateConversationFromMessageId(token, chatId, messageId)) ||
    (afterMessageId
      ? await truncateConversationAfterMessageId(token, chatId, afterMessageId)
      : false);
  if (!success) {
    res.status(404).json({ error: "消息不存在" });
    return;
  }

  res.status(200).json({ success: true });
}
