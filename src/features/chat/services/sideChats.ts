import { withAuthHeaders } from "@features/auth/client/authClient";
import type { SideChatMessage, SideChatThread } from "../types/selectionChat";

export const listSideChats = async ({
  token,
  conversationId,
  signal,
}: {
  token: string;
  conversationId: string;
  signal?: AbortSignal;
}): Promise<SideChatThread[]> => {
  if (!token || !conversationId) return [];
  const params = new URLSearchParams({ token, conversationId });
  const response = await fetch(`/api/v2/chat/side-chats?${params.toString()}`, {
    method: "GET",
    headers: withAuthHeaders({ "x-project-token": token }),
    signal,
  });
  if (!response.ok) return [];
  const data = (await response.json().catch(() => null)) as { threads?: SideChatThread[] } | null;
  return Array.isArray(data?.threads) ? data.threads : [];
};

export const deleteSideChat = async ({
  token,
  conversationId,
  threadId,
}: {
  token: string;
  conversationId: string;
  threadId: string;
}): Promise<boolean> => {
  if (!token || !conversationId || !threadId) return false;
  const params = new URLSearchParams({ token, conversationId, threadId });
  const response = await fetch(`/api/v2/chat/side-chats?${params.toString()}`, {
    method: "DELETE",
    headers: withAuthHeaders({ "x-project-token": token }),
  });
  return response.ok;
};

export interface StreamSideChatParams {
  token: string;
  conversationId?: string;
  threadId: string;
  sourceMessageId?: string;
  quoteText: string;
  prompt: string;
  userMessageId: string;
  messages: SideChatMessage[];
  model?: string;
  channel?: string;
  signal?: AbortSignal;
  onDelta: (text: string, messageId: string) => void;
  onDone: (payload: { threadId: string; messageId?: string; thread?: SideChatThread | null; aborted?: boolean }) => void;
  onError: (message: string) => void;
}

export const streamSideChatCompletion = async ({
  token,
  conversationId,
  threadId,
  sourceMessageId,
  quoteText,
  prompt,
  userMessageId,
  messages,
  model,
  channel,
  signal,
  onDelta,
  onDone,
  onError,
}: StreamSideChatParams): Promise<void> => {
  const response = await fetch("/api/v2/chat/side-completions", {
    method: "POST",
    headers: withAuthHeaders({
      "Content-Type": "application/json",
      "x-project-token": token,
    }),
    body: JSON.stringify({
      token,
      conversationId,
      threadId,
      sourceMessageId,
      quoteText,
      prompt,
      userMessageId,
      messages,
      model,
      channel,
    }),
    signal,
  });

  if (!response.ok) {
    const errPayload = (await response.json().catch(() => null)) as { error?: string } | null;
    onError(errPayload?.error || `请求失败 (${response.status})`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError("响应流不可用");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let receivedDone = false;

  const processEventBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }
    if (dataLines.length === 0) return;
    const rawData = dataLines.join("\n");
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      return;
    }

    if (eventName === "delta") {
      const text = typeof parsed.text === "string" ? parsed.text : "";
      const messageId = typeof parsed.messageId === "string" ? parsed.messageId : "";
      if (text) onDelta(text, messageId);
    } else if (eventName === "done") {
      receivedDone = true;
      onDone({
        threadId: typeof parsed.threadId === "string" ? parsed.threadId : threadId,
        messageId: typeof parsed.messageId === "string" ? parsed.messageId : undefined,
        thread: (parsed.thread as SideChatThread | null | undefined) ?? null,
        aborted: parsed.aborted === true,
      });
    } else if (eventName === "error") {
      receivedDone = true;
      onError(typeof parsed.message === "string" ? parsed.message : "侧边聊天生成失败");
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const block = buffer.slice(0, separatorIndex).trim();
        buffer = buffer.slice(separatorIndex + 2);
        if (block) processEventBlock(block);
        separatorIndex = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) {
      processEventBlock(buffer.trim());
    }
    if (!receivedDone) {
      onDone({ threadId });
    }
  } catch (error) {
    if (signal?.aborted) {
      onDone({ threadId, aborted: true });
      return;
    }
    onError(error instanceof Error ? error.message : "连接中断");
  } finally {
    reader.releaseLock();
  }
};
