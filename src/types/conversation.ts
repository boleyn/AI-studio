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
