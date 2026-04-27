// @ts-nocheck
// @ts-nocheck
import type { ConversationMessage } from "@server/conversations/conversationStorage";

export type ConversationHistoryWithSummary = {
  histories: ConversationMessage[];
  summary?: string;
};

export const getHistories = (
  history?: ConversationHistoryWithSummary | number,
  histories: ConversationHistoryWithSummary = { histories: [] }
): ConversationHistoryWithSummary => {
  const sourceHistories = Array.isArray(histories.histories) ? histories.histories : [];
  const systemHistoryIndex = sourceHistories.findIndex((item) => item.role !== "system");
  const systemHistories =
    systemHistoryIndex === -1 ? sourceHistories : sourceHistories.slice(0, systemHistoryIndex);
  const chatHistories = systemHistoryIndex === -1 ? [] : sourceHistories.slice(systemHistoryIndex);

  // 默认应保留完整历史；只有显式传入 history=0 或负数时才退化为仅 system。
  if (typeof history === "undefined") {
    return {
      histories: sourceHistories,
      summary: histories.summary,
    };
  }

  if (!history) {
    return {
      histories: systemHistories,
      summary: histories.summary,
    };
  }

  if (typeof history === "object" && Array.isArray(history.histories)) {
    return {
      histories: history.histories,
      summary: history.summary,
    };
  }

  const historyRounds = Number(history);
  if (!Number.isFinite(historyRounds) || historyRounds <= 0) {
    return {
      histories: systemHistories,
      summary: histories.summary,
    };
  }
  // FastGPT 的 history 语义是按「用户轮次」截断，而不是按消息条数截断。
  // 在当前项目里 tool 消息是独立 role，需要把它们跟随所在用户轮次保留，但不单独计轮。
  const filtered: ConversationMessage[] = [];
  let remainingRounds = Math.floor(historyRounds);
  for (let i = chatHistories.length - 1; i >= 0; i -= 1) {
    const message = chatHistories[i];
    filtered.unshift(message);
    if (message.role === "user") {
      remainingRounds -= 1;
      if (remainingRounds <= 0) {
        break;
      }
    }
  }

  return {
    histories: [...systemHistories, ...filtered],
    summary: histories.summary,
  };
};
