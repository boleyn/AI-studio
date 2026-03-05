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

type ArtifactFile = {
  name?: string;
  type?: string;
  storagePath?: string;
  parse?: {
    markdown?: string;
  };
};

const toArtifactFiles = (artifact: unknown): ArtifactFile[] => {
  if (!artifact || typeof artifact !== "object") return [];
  const files = (artifact as { files?: unknown }).files;
  return Array.isArray(files) ? (files as ArtifactFile[]) : [];
};

const isImageFile = (file: ArtifactFile) => (file.type || "").toLowerCase().startsWith("image/");

export const getHistoryFileLinks = (histories: ConversationMessage[]) => {
  const links = new Set<string>();
  for (const history of histories) {
    if (history.role !== "user") continue;
    for (const file of toArtifactFiles(history.artifact)) {
      if (!file.storagePath) continue;
      links.add(file.storagePath);
    }
  }
  return [...links];
};

export const getFileContentFromHistory = ({
  histories,
  maxChars = 24000,
}: {
  histories: ConversationMessage[];
  maxChars?: number;
}) => {
  const seen = new Set<string>();
  const sections: string[] = [];

  for (const history of histories) {
    if (history.role !== "user") continue;

    for (const file of toArtifactFiles(history.artifact)) {
      if (isImageFile(file)) continue;
      const markdown = (file.parse?.markdown || "").trim();
      if (!markdown) continue;

      const uniqueKey = file.storagePath || `${file.name || "file"}:${markdown.slice(0, 60)}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);

      sections.push(`### 文件: ${file.name || "file"}\n\n${markdown}`);
    }
  }

  if (sections.length === 0) return "";
  const joined = sections.join("\n\n------\n\n");
  if (joined.length <= maxChars) return joined;
  return joined.slice(0, maxChars);
};
