export const SseResponseEventEnum = {
  answer: "answer",
  reasoning: "reasoning",
  toolCall: "toolCall",
  toolParams: "toolParams",
  toolResponse: "toolResponse",
  flowNodeResponse: "flowNodeResponse",
  workflowDuration: "workflowDuration",
  error: "error",
} as const;

export type SseEventName = typeof SseResponseEventEnum[keyof typeof SseResponseEventEnum];
