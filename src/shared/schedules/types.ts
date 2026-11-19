export type ScheduleSpec = {
  title: string;
  prompt: string;
  firstAt: string;
  endDate?: string;
  newChatEachRun?: boolean;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
  timezone: string;
  repeat: "once" | "daily" | "weekdays" | "weekly" | "monthly" | "hourly" | "yearly";
  interval?: number;
};
export type Schedule = ScheduleSpec & {
  _id: string;
  token: string;
  chatId: string;
  state: "active" | "paused" | "running" | "completed";
  nextAt: number;
  lastResult?: string;
};
