export type ScheduleSpec = {
  title: string;
  prompt: string;
  firstAt: string;
  timezone: string;
  repeat: "once" | "daily" | "weekly";
};
export type Schedule = ScheduleSpec & {
  _id: string;
  token: string;
  chatId: string;
  state: "active" | "paused" | "running" | "completed";
  nextAt: number;
  lastResult?: string;
};
