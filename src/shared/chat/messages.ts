import { createDataId } from "./ids";

export type IncomingMessage = {
  type?: "user" | "assistant" | "system" | "tool" | "progress";
  role?: "user" | "assistant" | "system" | "tool";
  uuid?: string;
  timestamp?: string;
  message?: {
    role?: "user" | "assistant" | "system" | "tool";
    content?: unknown;
    id?: string;
  };
  content?: unknown;
  subtype?: string;
  parent_uuid?: string;
  is_sidechain?: boolean;
  session_id?: string;
  id?: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  meta?: Record<string, unknown>;
  additional_kwargs?: Record<string, unknown>;
  status?: "success" | "error";
  artifact?: unknown;
};

export const extractText = (content: unknown): string => {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        const block = item as Record<string, unknown>;
        if (typeof block.text === "string") return block.text;
        if (typeof block.thinking === "string") return block.thinking;
        if (typeof block.content === "string") return block.content;
        if (block.type === "tool_use") {
          const name = typeof block.name === "string" ? block.name : "tool";
          return `[tool_use:${name}]`;
        }
        return "";
      })
      .join("");
  }
  if (typeof content === "object") {
    const value = content as Record<string, unknown>;
    if (typeof value.text === "string") return value.text;
    if (typeof value.thinking === "string") return value.thinking;
    if (typeof value.content === "string") return value.content;
  }
  return String(content);
};

export const createId = () => createDataId();
