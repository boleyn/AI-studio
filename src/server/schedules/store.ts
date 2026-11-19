import { randomUUID } from "node:crypto";
import { DateTime, IANAZone } from "luxon";
import { z } from "zod";
import { getMongoDb } from "../db/mongo";
import { getProjectAccessState } from "../projects/projectStorage";
import { getConversation } from "../conversations/conversationStorage";
import type { Schedule, ScheduleSpec } from "@/shared/schedules/types";

export const specSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    prompt: z.string().trim().min(1).max(4000),
    reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
    model: z.string().trim().min(1).max(256).optional(),
    newChatEachRun: z.boolean().optional(),
    endDate: z.string().date().optional(),
    firstAt: z.string().datetime({ offset: true }),
    timezone: z.string().max(80).refine(IANAZone.isValidZone),
    interval: z.number().int().min(1).max(999).optional(),
    repeat: z.enum(["once", "daily", "weekdays", "weekly", "monthly", "hourly", "yearly"]),
  })
  .strict();

export type Scope = { owner: string; token: string; chatId: string };
export type StoredSchedule = Schedule & {
  owner: string;
  runId?: string;
  claimedAt?: number;
  revision?: number;
};
let indexes: Promise<unknown> | undefined;
export async function schedules() {
  const col = (await getMongoDb()).collection<StoredSchedule>(
    "conversation_schedules",
  );
  indexes ??= col
    .createIndexes([
      { key: { state: 1, nextAt: 1 } },
      { key: { owner: 1, nextAt: 1 } },
    ])
    .catch((error) => {
      indexes = undefined;
      throw error;
    });
  await indexes;
  return col;
}

export function nextOccurrence(spec: ScheduleSpec, now: number): number | null {
  const first = DateTime.fromISO(spec.firstAt, { zone: spec.timezone });
  const withinEndDate = (date: DateTime) => {
    const candidate = spec.repeat === "weekdays" && date.weekday > 5 ? date.plus({days:8-date.weekday}) : date;
    return spec.repeat !== "once" && spec.endDate && candidate.toISODate()! > spec.endDate ? null : candidate.toMillis();
  };
  if (first.toMillis() > now) return withinEndDate(first);
  if (spec.repeat === "once") return null;
  const interval = spec.interval ?? 1;
  if (spec.repeat === "hourly") {
    const elapsed = now - first.toMillis();
    const step = interval * 3600000;
    return withinEndDate(first.plus({milliseconds:(Math.floor(elapsed / step) + 1) * step}));
  }
  const step = (spec.repeat === "weekly" ? 7 : 1) * interval;
  const today = DateTime.fromMillis(now, { zone: spec.timezone }).startOf(
    "day",
  );
  if (spec.repeat === "monthly" || spec.repeat === "yearly") {
    const months = (today.year - first.year) * 12 + today.month - first.month;
    const stride = interval * (spec.repeat === "yearly" ? 12 : 1);
    const offset = Math.floor(months / stride) * stride;
    const candidate = first.plus({months:offset});
    return withinEndDate(candidate.toMillis() > now ? candidate : first.plus({months:offset + stride}));
  }
  const days =
    Math.floor(today.diff(first.startOf("day"), "days").days / step) * step;
  const candidate = first.plus({ days });
  return withinEndDate(candidate.toMillis() > now ? candidate : first.plus({ days: days + step }));
}

export async function checkScope(scope: Scope, requireChat = true) {
  if ((await getProjectAccessState(scope.token, scope.owner)) !== "ok")
    throw new Error("项目不可访问");
  if (requireChat && !(await getConversation(scope.token, scope.chatId)))
    throw new Error("请先在项目中保存一段对话");
}

export async function createSchedule(
  scope: Scope,
  input: unknown,
  draft = false,
) {
  const spec = specSchema.parse(input);
  const nextAt = nextOccurrence(spec, Date.now());
  if (!nextAt) throw new Error("所选日期范围内没有未来的执行时间");
  await checkScope(scope, !draft);
  const task: StoredSchedule = {
    ...scope,
    ...spec,
    _id: randomUUID(),
    state: draft ? "paused" : "active",
    nextAt,
  };
  await (await schedules()).insertOne(task);
  return task;
}
