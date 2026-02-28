import type { ConversationMessage } from "@/types/conversation";

export interface FlowNodeResponsePayload {
  nodeId?: string;
  moduleName?: string;
  moduleType?: string;
  runningTime?: number;
  status?: "success" | "error";
  toolInput?: unknown;
  toolRes?: unknown;
}

const parseMaybeJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const buildNodeTitle = (payload: FlowNodeResponsePayload) => {
  const statusLabel = payload.status === "error" ? "❌" : payload.status ? "✅" : "";
  const runningTimeLabel =
    typeof payload.runningTime === "number" ? `${payload.runningTime.toFixed(2)}s` : "";

  return [payload.moduleName || payload.nodeId || "节点", statusLabel, runningTimeLabel]
    .filter(Boolean)
    .join(" · ");
};

export const buildFlowNodeToolMessage = (payload: FlowNodeResponsePayload): ConversationMessage => {
  const messageId = payload.nodeId
    ? `flow-node-${payload.nodeId}`
    : `flow-node-${Date.now()}-${Math.random()}`;

  const params =
    payload.toolInput === undefined
      ? ""
      : typeof payload.toolInput === "string"
      ? payload.toolInput
      : JSON.stringify(payload.toolInput, null, 2);

  const response =
    payload.toolRes === undefined
      ? ""
      : typeof payload.toolRes === "string"
      ? payload.toolRes
      : JSON.stringify(payload.toolRes, null, 2);

  const title = buildNodeTitle(payload);

  return {
    role: "tool",
    id: messageId,
    name: title,
    content: JSON.stringify({
      toolName: title,
      params,
      response:
        payload.runningTime !== undefined || payload.status
          ? JSON.stringify(
              {
                result: response ? parseMaybeJson(response) : "",
                runningTime: payload.runningTime,
                status: payload.status,
              },
              null,
              2
            )
          : response,
    }),
  };
};

export const upsertFlowNodeToolMessage = ({
  assistantMessageId,
  messages,
  payload,
}: {
  assistantMessageId: string;
  messages: ConversationMessage[];
  payload: FlowNodeResponsePayload;
}): ConversationMessage[] => {
  const nextMessage = buildFlowNodeToolMessage(payload);
  const index = messages.findIndex((item) => item.id === nextMessage.id);

  if (index >= 0) {
    const next = [...messages];
    next[index] = nextMessage;
    return next;
  }

  const insertAt = messages.findIndex((item) => item.id === assistantMessageId);
  if (insertAt === -1) return [...messages, nextMessage];

  const next = [...messages];
  next.splice(insertAt, 0, nextMessage);
  return next;
};

