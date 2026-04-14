export const SseResponseEventEnum = {
  answer: "answer",
  reasoning: "reasoning",
  toolCall: "toolCall",
  toolParams: "toolParams",
  toolResponse: "toolResponse",
  toolInteraction: "toolInteraction",
  toolProgress: "toolProgress",
  flowNodeResponse: "flowNodeResponse",
  agentDuration: "agentDuration",
  contextWindow: "contextWindow",
  error: "error",
} as const;

export type SseEventName = typeof SseResponseEventEnum[keyof typeof SseResponseEventEnum];
