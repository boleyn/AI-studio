
import { requireAuth } from "@server/auth/session";
import { listConversations, type ConversationSummary } from "@server/conversations/conversationStorage";
import { getChatTokenAccessState } from "@server/chat/tokenAccess";
import type { NextApiRequest, NextApiResponse } from "next";

const getToken = (req: NextApiRequest): string | null => {
  const queryToken = typeof req.query.token === "string" ? req.query.token : null;
  const bodyToken = typeof req.body?.token === "string" ? req.body.token : null;
  return queryToken ?? bodyToken;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ list: ConversationSummary[]; total: number } | { error: string }>
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

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  const list = await listConversations(token);
  res.status(200).json({ list, total: list.length });
}
