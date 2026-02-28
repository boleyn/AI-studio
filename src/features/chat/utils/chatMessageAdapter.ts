import { extractText } from "@shared/chat/messages";

import { ChatItemValueTypeEnum } from "@/global/core/chat/constants";
import type {
  AIChatItemValueItemType,
  ChatItemValueItemType,
  ToolModuleResponseItemType,
} from "@/global/core/chat/type";
import type { ConversationMessage } from "@/types/conversation";

const safeJsonParse = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const toStringValue = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const toToolItem = (value: unknown, fallbackName?: string): ToolModuleResponseItemType => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    id: typeof record.id === "string" ? record.id : undefined,
    toolName:
      (typeof record.toolName === "string" && record.toolName) ||
      (typeof record.name === "string" && record.name) ||
      fallbackName ||
      "工具",
    toolAvatar: typeof record.toolAvatar === "string" ? record.toolAvatar : undefined,
    params: toStringValue(record.params),
    response: toStringValue(record.response),
  };
};

const normalizeStructuredValue = (value: unknown): ChatItemValueItemType | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";

  if (type === ChatItemValueTypeEnum.text) {
    const textValue =
      typeof record.text === "object" && record.text && "content" in record.text
        ? (record.text as { content?: unknown }).content
        : record.text;
    return {
      type: ChatItemValueTypeEnum.text,
      text: { content: toStringValue(textValue) },
    };
  }

  if (type === ChatItemValueTypeEnum.reasoning) {
    const reasoningValue =
      typeof record.reasoning === "object" && record.reasoning && "content" in record.reasoning
        ? (record.reasoning as { content?: unknown }).content
        : record.reasoning;
    return {
      type: ChatItemValueTypeEnum.reasoning,
      reasoning: { content: toStringValue(reasoningValue) },
    };
  }

  if (type === ChatItemValueTypeEnum.tool) {
    const tools = Array.isArray(record.tools)
      ? record.tools.map((tool) => toToolItem(tool)).filter((tool) => Boolean(tool.toolName))
      : [];

    if (tools.length === 0) return null;

    return {
      type: ChatItemValueTypeEnum.tool,
      tools,
    };
  }

  if (type === ChatItemValueTypeEnum.outline && record.outline) {
    const outlineRecord =
      record.outline && typeof record.outline === "object"
        ? (record.outline as Record<string, unknown>)
        : {};
    return {
      type: ChatItemValueTypeEnum.outline,
      outline: { text: toStringValue(outlineRecord.text) },
    };
  }

  if (type === ChatItemValueTypeEnum.interactive && record.interactive) {
    return {
      type: ChatItemValueTypeEnum.interactive,
      interactive: record.interactive,
    };
  }

  return null;
};

const parseAssistantStructuredValues = (content: unknown): ChatItemValueItemType[] | null => {
  const parseFromUnknown = (value: unknown): ChatItemValueItemType[] | null => {
    if (Array.isArray(value)) {
      const list = value
        .map((item) => normalizeStructuredValue(item))
        .filter((item): item is ChatItemValueItemType => Boolean(item));
      return list.length > 0 ? list : null;
    }

    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;

    const direct = normalizeStructuredValue(record);
    if (direct) return [direct];

    const candidates = [record.value, record.values, record.content];
    for (const candidate of candidates) {
      const parsed = parseFromUnknown(candidate);
      if (parsed && parsed.length > 0) return parsed;
    }

    return null;
  };

  if (typeof content === "string") {
    const trimmed = content.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return null;
    }
    const parsed = safeJsonParse<unknown>(trimmed);
    if (!parsed) return null;
    return parseFromUnknown(parsed);
  }

  return parseFromUnknown(content);
};

const adaptToolMessageValues = (message: ConversationMessage): AIChatItemValueItemType[] => {
  const parsed =
    typeof message.content === "string"
      ? safeJsonParse<unknown>(message.content)
      : message.content;

  const toolItem = toToolItem(parsed, message.name);

  return [
    {
      type: ChatItemValueTypeEnum.tool,
      tools: [toolItem],
    },
  ];
};

export const adaptConversationMessageToValues = (
  message: ConversationMessage
): ChatItemValueItemType[] => {
  if (message.role === "tool") {
    return adaptToolMessageValues(message);
  }

  if (message.role === "assistant") {
    const toolDetails = Array.isArray(message.additional_kwargs?.toolDetails)
      ? message.additional_kwargs.toolDetails
      : [];

    const structured = parseAssistantStructuredValues(message.content);
    const values: ChatItemValueItemType[] = [];

    if (toolDetails.length > 0) {
      const tools = toolDetails
        .map((tool) => toToolItem(tool))
        .filter((tool) => Boolean(tool.toolName));
      if (tools.length > 0) {
        values.push({
          type: ChatItemValueTypeEnum.tool,
          tools,
        });
      }
    }

    if (structured && structured.length > 0) {
      values.push(...structured);
      return values;
    }

    const text = extractText(message.content);
    if (text.trim()) {
      values.push({
        type: ChatItemValueTypeEnum.text,
        text: { content: text },
      });
    }

    return values;
  }

  const text = extractText(message.content);
  return [
    {
      type: ChatItemValueTypeEnum.text,
      text: { content: text },
    },
  ];
};
