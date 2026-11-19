import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getChatModelCatalog } from "@server/aiProxy/catalogStore";
import { listConversations } from "@server/conversations/conversationStorage";
import { getMongoDb } from "@server/db/mongo";
import { requireAuth } from "@server/auth/session";
import {
  checkScope,
  createSchedule,
  nextOccurrence,
  schedules,
  specSchema,
} from "@server/schedules/store";

const id = z.string().min(1).max(128);
const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      token: id,
      chatId: id,
      spec: specSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("edit"),
      id: z.string().uuid(),
      spec: specSchema,
    })
    .strict(),
  z
    .object({
      action: z.enum(["resume", "pause", "delete"]),
      id: z.string().uuid(),
    })
    .strict(),
]);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "private, no-store");
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const owner = String(auth.user._id);
  const col = await schedules();
  if (req.method === "GET") {
    const filter: { owner: string; token?: string } = { owner };
    const siteId = req.query.siteId;
    if (siteId !== undefined) {
      if (!id.safeParse(siteId).success) return res.status(400).json({ error: "站点编号无效" });
      const db = await getMongoDb();
      const site = await db.collection("share_links").findOne(
        { shareId: siteId, ownerUserId: owner, mode: "preview" },
        { projection: { projectToken: 1 } },
      );
      if (typeof site?.projectToken !== "string") return res.status(404).json({ error: "未找到站点" });
      filter.token = site.projectToken;
    }
    const tasks = await col
      .find(filter, { projection: { owner: 0, runId: 0, claimedAt: 0 } })
      .sort({ nextAt: 1 })
      .toArray();
    if (filter.token) {
      const [chats, catalog] = await Promise.all([listConversations(filter.token), getChatModelCatalog()]);
      const models = catalog.models.map(({id,label,reasoning}) => ({id,label,reasoning}));
      return res.status(200).json({ tasks, models, token: filter.token, chats: chats.map(({ id, title }) => ({ id, title })) });
    }
    return res.status(200).json({ tasks });
  }
  if (req.method !== "POST") return res.status(405).end();
  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "任务参数或时间格式无效" });
  const body = parsed.data;
  try {
    if (body.action === "create") {
      const task = await createSchedule(
        { owner, token: body.token, chatId: body.chatId },
        body.spec,
      );
      return res.status(201).json({ id: task._id });
    }
    const task = await col.findOne({ _id: body.id, owner });
    if (!task) return res.status(404).json({ error: "未找到任务" });
    if (task.state === "running")
      return res.status(409).json({ error: "运行中，请稍后操作" });
    const filter = {
      _id: task._id,
      owner,
      state: task.state,
      nextAt: task.nextAt,
      revision: task.revision ?? { $exists: false },
    };
    if (body.action === "delete") {
      if (!(await col.deleteOne(filter)).deletedCount)
        return res.status(409).json({ error: "运行中，请稍后操作" });
    } else {
      const spec = body.action === "edit" ? { ...task, ...body.spec } : task;
      const nextAt = nextOccurrence(spec, Date.now());
      if (body.action !== "pause") {
        await checkScope(task);
        if (!nextAt)
          return res.status(400).json({ error: "请选择未来的执行时间" });
      }
      const state =
        body.action === "resume"
          ? "active"
          : body.action === "pause"
            ? "paused"
            : task.state === "active"
              ? "active"
              : "paused";
      const update = await col.updateOne(filter, {
        $inc: { revision: 1 },
        $set: {
          ...(body.action === "edit" ? body.spec : {}),
          state,
          nextAt: nextAt ?? task.nextAt,
        },
      });
      if (!update.matchedCount)
        return res.status(409).json({ error: "任务状态已变化，请刷新后重试" });
    }
    return res.status(200).json({ ok: true });
  } catch {
    return res
      .status(400)
      .json({ error: "请确认来源会话存在、属于当前账号，且执行时间有效" });
  }
}
