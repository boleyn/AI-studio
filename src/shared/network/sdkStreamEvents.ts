export const SdkStreamEventEnum = {
  message: "message",
  streamEvent: "stream_event",
  status: "status",
  control: "control",
  done: "done",
  error: "error",
} as const;

export type SdkStreamEventName = typeof SdkStreamEventEnum[keyof typeof SdkStreamEventEnum];

export type SdkStreamEventPayload = {
  event: SdkStreamEventName;
  [key: string]: unknown;
};
