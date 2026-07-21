import type { ConversationMessage } from "@/types/conversation";

export interface MessageExecutionSummary {
  nodeCount: number;
  durationSeconds?: number;
}

export const getExecutionSummary = (
  message: ConversationMessage
): MessageExecutionSummary | null => {
  if (message.role !== "assistant") return null;
  const meta = message.additional_kwargs;
  if (!meta || typeof meta !== "object") return null;
  const sdkMessage =
    (meta as { sdkMessage?: unknown }).sdkMessage &&
    typeof (meta as { sdkMessage?: unknown }).sdkMessage === "object"
      ? ((meta as { sdkMessage: { message?: unknown } }).sdkMessage.message as
          | { content?: unknown }
          | undefined)
      : null;
  const content = Array.isArray(sdkMessage?.content) ? sdkMessage.content : [];
  const nodeCount = content.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const type = (item as { type?: unknown }).type;
    return type === "tool_use";
  }).length;
  const durationSeconds =
    typeof (meta as { durationSeconds?: unknown }).durationSeconds === "number"
      ? ((meta as { durationSeconds?: number }).durationSeconds ?? 0)
      : undefined;

  if (nodeCount === 0 && durationSeconds === undefined) return null;

  return {
    nodeCount,
    durationSeconds,
  };
};
