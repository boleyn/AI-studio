import { requireAuth } from "@server/auth/session";
import { resolvePendingConversationInteraction } from "@server/chat/activeRuns";
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
  res: NextApiResponse<{ success: boolean; resolved: boolean } | { error: string }>
) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const token = getToken(req);
  const chatId = getChatId(req);
  const requestId = typeof req.body?.requestId === "string" ? req.body.requestId.trim() : "";
  if (!token || !chatId || !requestId) {
    res.status(400).json({ error: "缺少 token、chatId 或 requestId 参数" });
    return;
  }

  const decision = req.body?.decision === "reject" ? "reject" : "approve";
  const answers =
    req.body?.answers && typeof req.body.answers === "object" && !Array.isArray(req.body.answers)
      ? Object.fromEntries(
          Object.entries(req.body.answers as Record<string, unknown>)
            .filter(([key, value]) => key && typeof value === "string")
            .map(([key, value]) => [key, String(value)])
        )
      : undefined;
  const note = typeof req.body?.note === "string" ? req.body.note : undefined;

  const resolved = resolvePendingConversationInteraction({
    token,
    chatId,
    requestId,
    decision: {
      decision,
      ...(answers ? { answers } : {}),
      ...(note ? { note } : {}),
      ...(req.body?.updatedInput !== undefined ? { updatedInput: req.body.updatedInput } : {}),
    },
  });

  res.status(200).json({ success: true, resolved });
}
