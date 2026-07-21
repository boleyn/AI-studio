export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ClaudeMessageType = "user" | "assistant" | "system" | "tool" | "progress";

export type ConversationMessage = {
  // Claude Code style envelope
  type?: ClaudeMessageType;
  subtype?: string;
  uuid?: string;
  parent_uuid?: string;
  is_sidechain?: boolean;
  session_id?: string;
  timestamp?: string;
  message?: {
    role?: "user" | "assistant" | "system" | "tool";
    id?: string;
    content?: unknown;
    [key: string]: unknown;
  };
  meta?: Record<string, unknown>;

  // Legacy field kept for transition; runtime now prefers `type`.
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
