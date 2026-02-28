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

  const responseData = Array.isArray((meta as { responseData?: unknown }).responseData)
    ? ((meta as { responseData?: unknown[] }).responseData ?? [])
    : [];
  const toolDetails = Array.isArray((meta as { toolDetails?: unknown }).toolDetails)
    ? ((meta as { toolDetails?: unknown[] }).toolDetails ?? [])
    : [];
  const nodeCount = Math.max(responseData.length, toolDetails.length);
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
