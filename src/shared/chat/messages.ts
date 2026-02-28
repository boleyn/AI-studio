import { getNanoid } from "@/global/common/string/tools";

export type AgentToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type AgentMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content?: string | null;
  id?: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: AgentToolCall[];
};

export type IncomingMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: unknown;
  id?: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: AgentToolCall[];
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
        if (item && typeof item === "object" && "text" in item) {
          const value = (item as { text?: unknown }).text;
          return typeof value === "string" ? value : String(value ?? "");
        }
        return String(item ?? "");
      })
      .join("");
  }
  if (typeof content === "object" && "text" in content) {
    const value = (content as { text?: unknown }).text;
    return typeof value === "string" ? value : String(value ?? "");
  }
  return String(content);
};

export const createId = () => {
  return getNanoid(24);
};
