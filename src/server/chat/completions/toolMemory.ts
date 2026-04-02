import type { ChatCompletionMessageParam } from "@aistudio/ai/compat/global/core/ai/type";
import type { ConversationMessage } from "@server/conversations/conversationStorage";
import { createDataId } from "@shared/chat/ids";

export type ToolDetail = {
  id?: string;
  toolName?: string;
  functionName?: string;
  params?: string;
  response?: string;
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

export const normalizeToolDetails = (value: unknown): ToolDetail[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : undefined,
      toolName: typeof item.toolName === "string" ? item.toolName : undefined,
      functionName: typeof item.functionName === "string" ? item.functionName : undefined,
      params: typeof item.params === "string" ? item.params : undefined,
      response: typeof item.response === "string" ? item.response : undefined,
    }));
};

export const toToolMemoryMessages = (message: ConversationMessage): ChatCompletionMessageParam[] => {
  if (message.role !== "assistant") return [];
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return [];

  const toolDetails = normalizeToolDetails(
    (message.additional_kwargs as { toolDetails?: unknown }).toolDetails
  );
  if (toolDetails.length === 0) return [];

  const baseId = message.id || createDataId();
  const normalizedCalls: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
    response: string;
  }> = [];
  const idToIndex = new Map<string, number>();

  toolDetails.forEach((detail, index) => {
    const toolCallId = detail.id?.trim() || `${baseId}-tool-${index + 1}`;
    const functionName = detail.functionName?.trim() || detail.toolName?.trim() || "tool";
    const next = {
      id: toolCallId,
      type: "function" as const,
      function: {
        name: functionName,
        arguments: detail.params || "",
      },
      response: detail.response || "",
    };

    const existingIndex = idToIndex.get(toolCallId);
    if (existingIndex == null) {
      idToIndex.set(toolCallId, normalizedCalls.length);
      normalizedCalls.push(next);
      return;
    }

    // Stopped runs may leave duplicate shells sharing the same tool_call id.
    // Merge duplicates into one canonical call before rebuilding tool memory messages.
    const prev = normalizedCalls[existingIndex];
    normalizedCalls[existingIndex] = {
      ...prev,
      function: {
        name: prev.function.name && prev.function.name !== "tool" ? prev.function.name : next.function.name,
        arguments:
          next.function.arguments.length > prev.function.arguments.length
            ? next.function.arguments
            : prev.function.arguments,
      },
      response: next.response.length > prev.response.length ? next.response : prev.response,
    };
  });

  const assistantToolCallMessage = {
    role: "assistant" as const,
    content: "",
    tool_calls: normalizedCalls.map((call) => ({
      id: call.id,
      type: call.type,
      function: call.function,
    })),
  } as ChatCompletionMessageParam;

  const toolMessages = normalizedCalls.map(
    (call) =>
      ({
        role: "tool" as const,
        tool_call_id: call.id,
        name: call.function.name,
        content: call.response,
      }) as ChatCompletionMessageParam
  );

  return [assistantToolCallMessage, ...toolMessages];
};

export const mergeAssistantToolMessages = (messages: ConversationMessage[]): ConversationMessage[] => {
  const output: ConversationMessage[] = [];
  const pendingCalls = new Map<string, { functionName?: string; params?: string }>();

  const appendToolToLastAssistant = (tool: ToolDetail) => {
    for (let i = output.length - 1; i >= 0; i -= 1) {
      if (output[i].role !== "assistant") continue;
      const current = output[i];
      const kwargs =
        current.additional_kwargs && typeof current.additional_kwargs === "object"
          ? current.additional_kwargs
          : {};
      const toolDetails = Array.isArray((kwargs as { toolDetails?: unknown }).toolDetails)
        ? ((kwargs as { toolDetails?: ToolDetail[] }).toolDetails as ToolDetail[])
        : [];

      output[i] = {
        ...current,
        additional_kwargs: {
          ...kwargs,
          toolDetails: [...toolDetails, tool],
        },
      };
      return;
    }
  };

  for (const message of messages) {
    if (message.role === "assistant") {
      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          if (!call?.id) continue;
          pendingCalls.set(call.id, {
            functionName: call.function?.name,
            params: call.function?.arguments || "",
          });
        }
      }
      output.push(message);
      continue;
    }

    if (message.role === "tool") {
      let parsed: unknown = null;
      if (typeof message.content === "string") {
        try {
          parsed = JSON.parse(message.content || "{}");
        } catch {
          parsed = null;
        }
      }
      const parsedObj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      const toolId =
        message.tool_call_id ||
        (typeof parsedObj.id === "string" ? parsedObj.id : undefined) ||
        message.id;
      const pending = toolId ? pendingCalls.get(toolId) : undefined;
      appendToolToLastAssistant({
        id: toolId,
        toolName:
          message.name ||
          (typeof parsedObj.toolName === "string" ? parsedObj.toolName : undefined) ||
          pending?.functionName ||
          "工具",
        functionName:
          (typeof parsedObj.functionName === "string" ? parsedObj.functionName : undefined) ||
          pending?.functionName ||
          message.name ||
          "tool",
        params:
          (typeof parsedObj.params === "string" ? parsedObj.params : undefined) ||
          pending?.params ||
          "",
        response:
          (typeof parsedObj.response === "string" ? parsedObj.response : undefined) ||
          toStringValue(message.content),
      });
      continue;
    }

    output.push(message);
  }

  return output;
};
