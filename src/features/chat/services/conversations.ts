import { createId } from "@shared/chat/messages";

import type { ChatHistoryItemType } from "../types/conversationApi";

import {
  clearConversationHistories,
  deleteConversationHistory,
  getConversationHistories,
  getConversationInit,
  getConversationRecordsV2,
  putConversationHistory,
} from "./conversationApi";

import type { Conversation, ConversationMessage, ConversationSummary } from "@/types/conversation";

const HISTORY_TITLE = "历史记录";

const normalizeConversationSummary = (item: ChatHistoryItemType): ConversationSummary | null => {
  const id = item.id || item.chatId;
  if (!id) return null;

  const now = new Date().toISOString();
  const createdAt = item.createdAt || item.createTime || item.updateTime || now;
  const updatedAt = item.updatedAt || item.updateTime || createdAt;

  return {
    id,
    title: (item.customTitle || item.title || HISTORY_TITLE).trim() || HISTORY_TITLE,
    createdAt,
    updatedAt,
  };
};

export async function listConversations(token: string): Promise<ConversationSummary[]> {
  try {
    const payload = await getConversationHistories({ token });
    return (payload.list || [])
      .map(normalizeConversationSummary)
      .filter((item): item is ConversationSummary => Boolean(item));
  } catch {
    return [];
  }
}

export async function createConversation(
  token: string,
  messages: ConversationMessage[]
): Promise<Conversation | null> {
  const chatId = createId();
  try {
    const payload = await putConversationHistory({ token, chatId, messages });
    if (payload?.history) return payload.history;
    return getConversation(token, chatId);
  } catch {
    return null;
  }
}

export async function deleteAllConversations(token: string): Promise<number> {
  try {
    const payload = await clearConversationHistories({ token });
    return payload.deletedCount ?? 0;
  } catch {
    return 0;
  }
}

export async function getConversation(
  token: string,
  id: string
): Promise<Conversation | null> {
  try {
    const [initPayload, recordsPayload] = await Promise.all([
      getConversationInit({ token, chatId: id }),
      getConversationRecordsV2({ token, chatId: id, pageSize: 2000 }),
    ]);

    const messages = Array.isArray(recordsPayload.list) ? recordsPayload.list : [];
    const now = new Date().toISOString();
    return {
      id,
      title: initPayload.title || HISTORY_TITLE,
      createdAt: now,
      updatedAt: now,
      messages,
    };
  } catch {
    return null;
  }
}

export async function deleteConversation(token: string, id: string): Promise<boolean> {
  try {
    await deleteConversationHistory({ token, chatId: id });
    return true;
  } catch {
    return false;
  }
}
