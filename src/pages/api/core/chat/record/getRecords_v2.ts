
import { requireAuth } from "@server/auth/session";
import { getConversationRecordsV2 } from "@server/conversations/conversationStorage";
import type { NextApiRequest, NextApiResponse } from "next";

const getToken = (req: NextApiRequest): string | null => {
  const queryToken = typeof req.query.token === "string" ? req.query.token : null;
  const bodyToken = typeof req.body?.token === "string" ? req.body.token : null;
  return queryToken ?? bodyToken;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    | { list: unknown[]; total: number; hasMorePrev: boolean; hasMoreNext: boolean }
    | { error: string }
  >
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

  const chatId = typeof req.body?.chatId === "string" ? req.body.chatId : null;
  if (!chatId) {
    res.status(400).json({ error: "缺少 chatId 参数" });
    return;
  }

  const pageSize = Number.isFinite(Number(req.body?.pageSize)) ? Number(req.body.pageSize) : 50;
  const initialId = typeof req.body?.initialId === "string" ? req.body.initialId : undefined;
  const prevId = typeof req.body?.prevId === "string" ? req.body.prevId : undefined;
  const nextId = typeof req.body?.nextId === "string" ? req.body.nextId : undefined;
  const includeDeleted = req.body?.includeDeleted === true;

  const result = await getConversationRecordsV2({
    token,
    chatId,
    pageSize,
    initialId,
    prevId,
    nextId,
    includeDeleted,
  });

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    list: result.list.map((item) => ({ ...item, id: item.id || "" })),
    total: result.total,
    hasMorePrev: result.hasMorePrev,
    hasMoreNext: result.hasMoreNext,
  });
}
