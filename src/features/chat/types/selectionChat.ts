export interface SelectionQuote {
  id: string;
  text: string;
  messageId?: string;
  role?: "user" | "assistant" | "system";
}

export interface SideChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  quoteText?: string;
  createdAt: string;
}

export interface SideChatThread {
  id: string;
  token: string;
  chatId: string;
  sourceMessageId?: string;
  quoteText: string;
  title: string;
  messages: SideChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export const normalizeSelectionQuotes = (raw: unknown): SelectionQuote[] => {
  if (!Array.isArray(raw)) return [];
  const result: SelectionQuote[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) continue;
    const id =
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : `quote-${result.length + 1}`;
    const messageId =
      typeof record.messageId === "string" && record.messageId.trim()
        ? record.messageId.trim()
        : undefined;
    const role =
      record.role === "user" || record.role === "assistant" || record.role === "system"
        ? record.role
        : undefined;
    result.push({
      id,
      text,
      ...(messageId ? { messageId } : {}),
      ...(role ? { role } : {}),
    });
  }
  return result;
};

export const extractSelectionQuotesFromMessage = (message: {
  meta?: Record<string, unknown>;
  additional_kwargs?: Record<string, unknown>;
}): SelectionQuote[] => {
  const fromMeta = normalizeSelectionQuotes(message.meta?.selectionQuotes);
  if (fromMeta.length > 0) return fromMeta;
  const fromKwargs = normalizeSelectionQuotes(message.additional_kwargs?.selectionQuotes);
  if (fromKwargs.length > 0) return fromKwargs;
  const sdkMsg = message.additional_kwargs?.sdkMessage;
  if (sdkMsg && typeof sdkMsg === "object" && !Array.isArray(sdkMsg)) {
    const sdkMeta = (sdkMsg as Record<string, unknown>).meta;
    if (sdkMeta && typeof sdkMeta === "object" && !Array.isArray(sdkMeta)) {
      return normalizeSelectionQuotes((sdkMeta as Record<string, unknown>).selectionQuotes);
    }
  }
  return [];
};

export const formatSelectionQuotesForPrompt = (quotes: SelectionQuote[]): string => {
  if (quotes.length === 0) return "";
  const formatted = quotes
    .map((quote, index) => {
      const header =
        quotes.length > 1 ? `[引用片段 ${index + 1}]` : "[用户引用的对话片段]";
      const quotedBody = quote.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return `${header}\n${quotedBody}`;
    })
    .join("\n\n");
  return `${formatted}\n\n请重点围绕以上引用的内容回答下面的问题：`;
};
