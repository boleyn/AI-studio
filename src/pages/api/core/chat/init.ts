
import { requireAuth } from "@server/auth/session";
import { getChatTokenAccessState } from "@server/chat/tokenAccess";
import { getConversation } from "@server/conversations/conversationStorage";
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
  res: NextApiResponse<{ chatId: string; title?: string } | { error: string }>
) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

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

  const history = await getConversation(token, chatId);
  res.status(200).json({ chatId, ...(history ? { title: history.title } : {}) });
}
