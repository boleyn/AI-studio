import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { getChatTokenAccessState } from "@server/chat/tokenAccess";
import {
  deleteSideChat,
  listSideChats,
} from "@server/conversations/sideChatStorage";

const getQueryString = (value: string | string[] | undefined): string => {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const token =
    (typeof req.headers["x-project-token"] === "string"
      ? req.headers["x-project-token"].trim()
      : "") ||
    getQueryString(req.query.token) ||
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
    getQueryString(req.query.conversationId) ||
    getQueryString(req.query.conversation_id) ||
    (typeof req.body?.conversationId === "string" ? req.body.conversationId.trim() : "");

  if (!conversationId) {
    res.status(400).json({ error: "缺少 conversationId" });
    return;
  }

  if (req.method === "GET") {
    try {
      const threads = await listSideChats(token, conversationId);
      res.status(200).json({ threads });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "加载侧边聊天失败",
      });
    }
    return;
  }

  if (req.method === "DELETE") {
    const threadId =
      getQueryString(req.query.threadId) ||
      (typeof req.body?.threadId === "string" ? req.body.threadId.trim() : "");
    if (!threadId) {
      res.status(400).json({ error: "缺少 threadId" });
      return;
    }
    try {
      const deleted = await deleteSideChat(token, conversationId, threadId);
      res.status(200).json({ deleted });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "删除侧边聊天失败",
      });
    }
    return;
  }

  res.setHeader("Allow", "GET, DELETE");
  res.status(405).json({ error: "Method Not Allowed" });
}
