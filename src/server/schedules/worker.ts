import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { getChatModelCatalog } from "../aiProxy/catalogStore";
import {
  getConversation,
  appendConversationMessages,
} from "../conversations/conversationStorage";
import { getProjectAccessState } from "../projects/projectStorage";
import { createAgentModelClient } from "@/agent/app/modelClient";
import {
  getConfiguredContextWindow,
  resolveModelConnection,
} from "@/agent/gateway/modelConnection";
import {
  nextOccurrence,
  schedules,
  specSchema,
  type StoredSchedule,
} from "./store";

async function reply(task: StoredSchedule) {
  if ((await getProjectAccessState(task.token, task.owner)) !== "ok")
    throw new Error("项目不可访问");
  const chat = task.newChatEachRun ? undefined : await getConversation(task.token, task.chatId);
  if (!task.newChatEachRun && !chat) throw new Error("来源会话已删除");
  const history = (chat?.messages ?? []).slice(-16).flatMap((m) => {
    if (m.role !== "assistant" && m.role !== "user") return [];
    const content =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((b) => b?.type === "text" && typeof b.text === "string")
              .map((b) => b.text)
              .join("\n")
          : "";
    return content ? [{ role: m.role, content: content.slice(-2000) }] : [];
  });
  const catalog = await getChatModelCatalog();
  const model = task.model ?? catalog.defaultModel;
  if (task.model && !catalog.models.some(option => option.id === model)) throw new Error("所选模型已不可用");
  const client = createAgentModelClient(
    model,
    getConfiguredContextWindow(model),
    await resolveModelConnection(model),
  );
  const result = await client.complete(
    {
      model,
      messages: [
        {
          role: "system",
          content:
            "Complete the scheduled instruction using the supplied conversation. You have no external tools. Never claim to have taken external actions.",
        },
        ...history,
        { role: "user", content: task.prompt },
      ],
      ...(task.reasoningEffort && catalog.models.find(option => option.id === model)?.reasoning ? { reasoning_effort: task.reasoningEffort } : {}),
      max_tokens: 2000,
    },
    AbortSignal.timeout(90_000),
  );
  const text = result.choices[0]?.message.content?.trim();
  if (!text) throw new Error("模型未返回内容");
  if ((await getProjectAccessState(task.token, task.owner)) !== "ok")
    throw new Error("项目不可访问");
  await appendConversationMessages(
    task.token,
    task.newChatEachRun ? task.runId ?? randomUUID() : task.chatId,
    [
      ...(task.newChatEachRun ? [{role:"user" as const, id:randomUUID(), content:task.prompt}] : []),
      {
        role: "assistant",
        id: task.runId,
        content: `定时任务 · ${task.title}\n\n${text}`,
      },
    ],
    task.newChatEachRun ? task.title : undefined,
    !task.newChatEachRun,
  );
}

export async function tick() {
  const col = await schedules();
  const now = Date.now();
  await col.updateMany(
    { state: "running", claimedAt: { $lt: now - 600_000 } },
    { $set: { state: "paused", lastResult: "执行中断，请检查会话后恢复" } },
  );
  const task = await col.findOneAndUpdate(
    { state: "active", nextAt: { $lte: now } },
    { $set: { state: "running", claimedAt: now, runId: randomUUID() } },
    { sort: { nextAt: 1 }, returnDocument: "after" },
  );
  if (!task) return;
  const claim = { _id: task._id, state: "running" as const, runId: task.runId };
  try {
    const { title, prompt, timezone, firstAt, repeat, endDate } = task;
    specSchema.parse({ title, prompt, timezone, firstAt, repeat, endDate });
    const today = DateTime.fromMillis(now, { zone: timezone }).toISODate();
    if (repeat !== "once" && endDate && today && today > endDate) {
      await col.updateOne(claim, {
        $set: { state: "completed", lastResult: "已过结束日期，任务已结束" },
      });
      return;
    }
    await reply(task);
    const nextAt = nextOccurrence(task, Date.now());
    await col.updateOne(claim, {
      $set: {
        state: nextAt ? "active" : "completed",
        nextAt: nextAt ?? task.nextAt,
        lastResult: "结果已发送至会话",
      },
    });
  } catch {
    await col.updateOne(claim, {
      $set: {
        state: "paused",
        lastResult: "运行失败，请检查会话和模型配置后恢复",
      },
    });
  }
}

export function startScheduleWorker() {
  const state = globalThis as typeof globalThis & {
    scheduleTimer?: NodeJS.Timeout;
  };
  if (state.scheduleTimer) return;
  let busy = false;
  const poll = async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } catch {
      console.error("[schedules] poll failed");
    } finally {
      busy = false;
    }
  };
  state.scheduleTimer = setInterval(() => void poll(), 5000);
  state.scheduleTimer.unref();
}
