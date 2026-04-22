import { requireAuth } from "@server/auth/session";
import { getChatFileSnapshotByAssistantMessageId } from "@server/chat/fileSnapshotStorage";
import {
  getConversationRecordsV2,
  truncateConversationFromMessageId,
} from "@server/conversations/conversationStorage";
import { getChatTokenAccessState } from "@server/chat/tokenAccess";
import { updateFiles } from "@server/projects/projectStorage";
import { updateUserSkill } from "@server/skills/skillStorage";
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
  res: NextApiResponse<
    | { success: true; files?: Record<string, { code: string }> }
    | { success: false; error: string }
  >
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const token = getToken(req)?.trim();
  const chatId = getChatId(req)?.trim();
  if (!token) {
    res.status(400).json({ success: false, error: "缺少 token 参数" });
    return;
  }
  if (!chatId) {
    res.status(400).json({ success: false, error: "缺少 chatId 参数" });
    return;
  }

  const access = await getChatTokenAccessState(token, String(auth.user._id));
  if (access === "not_found") {
    res.status(404).json({ success: false, error: "项目或技能不存在" });
    return;
  }
  if (access === "forbidden") {
    res.status(403).json({ success: false, error: "无权访问该项目或技能" });
    return;
  }

  const records = await getConversationRecordsV2({
    token,
    chatId,
    pageSize: 2000,
  });
  const all = Array.isArray(records.list) ? records.list : [];
  if (all.length === 0) {
    res.status(404).json({ success: false, error: "没有可回退的对话" });
    return;
  }

  const lastAssistantIndex = [...all]
    .map((item, index) => ({ item, index }))
    .reverse()
    .find(({ item }) => item.role === "assistant" && typeof item.id === "string" && item.id.trim())?.index ?? -1;
  if (lastAssistantIndex < 0) {
    res.status(404).json({ success: false, error: "没有可回退的助手回复" });
    return;
  }

  const assistantMessage = all[lastAssistantIndex];
  const assistantMessageId = (assistantMessage.id || "").trim();
  let anchorUserId = "";
  for (let i = lastAssistantIndex - 1; i >= 0; i -= 1) {
    const entry = all[i];
    if (!entry || entry.role !== "user") continue;
    if (typeof entry.id === "string" && entry.id.trim()) {
      anchorUserId = entry.id.trim();
      break;
    }
  }
  if (!anchorUserId) {
    res.status(404).json({ success: false, error: "没有可回退的用户提问" });
    return;
  }

  const truncated = await truncateConversationFromMessageId(token, chatId, anchorUserId);
  if (!truncated) {
    res.status(404).json({ success: false, error: "消息回退失败" });
    return;
  }

  const snapshot = await getChatFileSnapshotByAssistantMessageId({
    token,
    chatId,
    assistantMessageId,
  });
  if (snapshot) {
    if (access === "ok_project") {
      await updateFiles(token, snapshot);
    } else {
      await updateUserSkill({
        token,
        userId: String(auth.user._id),
        updates: {
          files: snapshot,
        },
      });
    }
    res.status(200).json({ success: true, files: snapshot });
    return;
  }

  res.status(200).json({ success: true });
}
