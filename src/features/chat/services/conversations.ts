import { createChatId } from "@shared/chat/ids";

import type { ChatHistoryItemType } from "../types/conversationApi";

import {
  clearConversationHistories,
  deleteConversationMessage,
  deleteConversationHistory,
  getConversationHistories,
  getConversationInit,
  getConversationRecordsV2,
  putConversationHistory,
  rewindConversationLatestTurn,
  truncateConversationFromMessage,
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
  const chatId = createChatId();
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
  id: string,
  options?: { model?: string }
): Promise<Conversation | null> {
  try {
    const [initPayload, recordsPayload] = await Promise.all([
      getConversationInit({ token, chatId: id }),
      getConversationRecordsV2({ token, chatId: id, pageSize: 2000, ...(options?.model ? { model: options.model } : {}) }),
    ]);

    const messages = Array.isArray(recordsPayload.list) ? [...recordsPayload.list] : [];
    const contextWindow =
      recordsPayload.contextWindow && typeof recordsPayload.contextWindow === "object"
        ? recordsPayload.contextWindow
        : null;
    if (contextWindow && messages.length > 0) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role !== "assistant") continue;
        const kwargs =
          messages[i].additional_kwargs && typeof messages[i].additional_kwargs === "object"
            ? messages[i].additional_kwargs
            : {};
        messages[i] = {
          ...messages[i],
          additional_kwargs: {
            ...kwargs,
            contextWindow,
          },
        };
        break;
      }
    }
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

export async function replaceConversationMessages(
  token: string,
  chatId: string,
  messages: ConversationMessage[]
): Promise<boolean> {
  try {
    await putConversationHistory({ token, chatId, messages });
    return true;
  } catch {
    return false;
  }
}

export async function deleteConversationMessageById(
  token: string,
  chatId: string,
  messageId: string
): Promise<boolean> {
  try {
    await deleteConversationMessage({
      token,
      chatId,
      messageId,
    });
    return true;
  } catch {
    return false;
  }
}

export async function truncateConversationFromMessageId(
  token: string,
  chatId: string,
  messageId: string,
  afterMessageId?: string
): Promise<boolean> {
  try {
    await truncateConversationFromMessage({
      token,
      chatId,
      messageId,
      ...(afterMessageId ? { afterMessageId } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

export async function rewindLatestConversationTurn(
  token: string,
  chatId: string
): Promise<{ success: boolean; files?: Record<string, { code: string }> }> {
  try {
    const payload = await rewindConversationLatestTurn({ token, chatId });
    return {
      success: payload?.success !== false,
      ...(payload?.files && typeof payload.files === "object" ? { files: payload.files } : {}),
    };
  } catch {
    return { success: false };
  }
}
