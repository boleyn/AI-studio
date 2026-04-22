import { createDataId } from "./ids";

export type SdkRole = "user" | "assistant" | "system" | "tool";

export type SdkContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        data: string;
      };
    }
  | { type: "thinking"; thinking: string }
  | {
      type: "agent_start";
      id: string;
      agent_type?: string;
      description?: string;
      prompt?: string;
    }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input?: Record<string, unknown>;
      parent_agent_tool_use_id?: string;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      name?: string;
      input?: Record<string, unknown>;
      parent_agent_tool_use_id?: string;
      is_error?: boolean;
    }
  | {
      type: "attachment";
      name?: string;
      mime_type?: string;
      storage_path?: string;
      source_storage_path?: string;
      preview_url?: string;
      download_url?: string;
    };

export type SdkMessagePayload = {
  role: SdkRole;
  id?: string;
  content?: string | SdkContentBlock[];
  [key: string]: unknown;
};

export type SdkMessage = {
  type: "user" | "assistant" | "system" | "progress";
  uuid: string;
  timestamp: string;
  message?: SdkMessagePayload;
  meta?: Record<string, unknown>;
};

export const createSdkMessage = (input: {
  type: SdkMessage["type"];
  message?: SdkMessagePayload;
  meta?: Record<string, unknown>;
  uuid?: string;
  timestamp?: string;
}): SdkMessage => ({
  type: input.type,
  uuid: input.uuid || createDataId(),
  timestamp: input.timestamp || new Date().toISOString(),
  ...(input.message ? { message: input.message } : {}),
  ...(input.meta ? { meta: input.meta } : {}),
});

export const sdkContentToText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const block = item as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") return block.text;
      if (block.type === "thinking" && typeof block.thinking === "string") return block.thinking;
      if (block.type === "tool_result" && typeof block.content === "string") return block.content;
      return "";
    })
    .join("");
};
