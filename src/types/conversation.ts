export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ConversationMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: unknown;
  /**
   * Message creation time used for UI display (e.g. "刚刚/几分钟前/年月日").
   * Some backend payloads attach this as ISO string.
   */
  time?: Date | string;
  id?: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  additional_kwargs?: Record<string, unknown>;
  status?: "success" | "error";
  artifact?: unknown;
};

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = ConversationSummary & {
  messages: ConversationMessage[];
};
