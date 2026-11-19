import type { AgentPlugin } from "@/agent/plugins/types";
import { createSchedule, type Scope } from "./store";

export function schedulePlugin(scope?: Scope): AgentPlugin {
  return {
    manifest: {
      id: "schedules",
      version: "1.0.0",
      description: "Conversation schedules",
      defaultEnabled: true,
    },
    setup(context) {
      if (!scope) return;
      context.registerTool({
        name: "ScheduleTask",
        toolset: "schedules",
        description:
          "Prepare a one-time, daily or weekly task for this conversation. The user activates it in 定时任务. Ask if the time or timezone is ambiguous.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["title", "prompt", "firstAt", "timezone", "repeat"],
          properties: {
            title: { type: "string", maxLength: 100 },
            prompt: { type: "string", maxLength: 4000 },
            firstAt: {
              type: "string",
              description: "ISO 8601 date and time with UTC offset",
            },
            timezone: { type: "string", description: "IANA zone" },
            repeat: { type: "string", enum: ["once", "daily", "weekdays", "weekly", "monthly"] },
          },
        },
        async handler(input, ctx) {
          if (ctx.isSubagent)
            return {
              isError: true,
              content: "Scheduling requires the main conversation.",
            };
          const task = await createSchedule(scope, input, true);
          return {
            content: JSON.stringify({
              id: task._id,
              state: "paused",
              nextAt: new Date(task.nextAt).toISOString(),
              message: "任务已保存，请在定时任务页启用。",
            }),
          };
        },
      });
    },
  };
}
