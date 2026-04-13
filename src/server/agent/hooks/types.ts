export type HookEventName =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "SubagentStart"
  | "SubagentStop";

export type HookConfig = {
  event: HookEventName;
  command: string;
  timeoutMs?: number;
};

export type PreToolHookInput = {
  event: "PreToolUse";
  sessionId?: string;
  toolName: string;
  toolInput: unknown;
};

export type PostToolHookInput = {
  event: "PostToolUse" | "PostToolUseFailure";
  sessionId?: string;
  toolName: string;
  toolInput: unknown;
  toolResponse?: unknown;
  error?: string;
};

export type SubagentHookInput = {
  event: "SubagentStart" | "SubagentStop";
  sessionId?: string;
  agentId: string;
  agentName?: string;
  status?: string;
};

export type PreToolHookResult = {
  decision?: "allow" | "block" | "ask";
  reason?: string;
  updatedInput?: unknown;
};

export type PostToolHookResult = {
  updatedToolOutput?: unknown;
  additionalContext?: string;
};
