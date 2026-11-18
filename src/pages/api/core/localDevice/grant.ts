import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAuth } from "@server/auth/session";
import { getProject } from "@server/projects/projectStorage";
import { createLocalDeviceGateway } from "@/server/localDevice/gateway";
import {
  findDevice,
  findGrant,
  listGrantsForScope,
  markGrantRevoked,
  upsertGrant,
} from "@/server/localDevice/store";

const GrantActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("list"),
      appId: z.string().min(1).max(128),
      deviceId: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("request"),
      appId: z.string().min(1).max(128),
      chatId: z.string().min(1).max(128).optional(),
      deviceId: z.string().uuid(),
      initialWorkdir: z.string().max(4096).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("revoke"),
      grantId: z.string().uuid(),
    })
    .strict(),
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;
  const userId = auth.user._id != null ? String(auth.user._id) : "";
  if (!userId) {
    res.status(401).json({ error: "用户身份无效" });
    return;
  }

  const parsed = GrantActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const body = parsed.data;
  const gateway = createLocalDeviceGateway();

  if (body.action === "list") {
    const grants = await listGrantsForScope({
      userId,
      appId: body.appId,
      deviceId: body.deviceId,
    });
    res.status(200).json({ grants });
    return;
  }

  if (body.action === "revoke") {
    const existing = await findGrant(body.grantId);
    if (!existing || existing.teamId !== userId) {
      res.status(404).json({ error: "grant_not_found" });
      return;
    }
    const revoked = await markGrantRevoked(body.grantId, userId);
    if (revoked) {
      await gateway
        .controlGrant({
          action: "grant_revoke",
          grant: {
            teamId: revoked.teamId,
            memberId: revoked.memberId,
            deviceId: revoked.deviceId,
            appId: revoked.appId,
            chatId: revoked.chatId,
            sourceTarget: revoked.sourceTarget,
            grantId: revoked.grantId,
            version: revoked.version,
            expiresAt: revoked.expiresAt,
            workdir: revoked.workdir,
            revoked: true,
          },
        })
        .catch(() => {});
    }
    res.status(200).json({ success: true });
    return;
  }

  const project = await getProject(body.appId);
  if (!project || project.userId !== userId) {
    res.status(403).json({ error: "无权访问该项目" });
    return;
  }

  const device = await findDevice(body.deviceId);
  if (!device || device.revoked || device.teamId !== userId) {
    res.status(404).json({ error: "device_not_found" });
    return;
  }

  const chatId = body.chatId || `project_${project.token}`;
  const sourceTarget = `project:${project.token}`;
  try {
    const grants = await listGrantsForScope({ userId, appId: project.token, deviceId: device.deviceId });
    const existing = grants.find(g =>
      g.chatId === chatId && g.sourceTarget === sourceTarget && g.locallyApproved &&
      g.capabilities.includes("exec") && (!g.expiresAt || g.expiresAt > Date.now()) &&
      (!body.initialWorkdir || g.workdir === body.initialWorkdir)
    );
    if (existing) {
      const grant = await gateway.controlGrant({
        action: "grant_renew",
        leaseExpiresAt: Math.min(Date.now() + 50_000, existing.expiresAt || Infinity),
        grant: {
          teamId: existing.teamId, memberId: existing.memberId, deviceId: existing.deviceId,
          appId: existing.appId, chatId, sourceTarget, grantId: existing.grantId,
          version: existing.version, expiresAt: existing.expiresAt, workdir: existing.workdir,
          revoked: false,
        },
      });
      res.status(200).json({ grant, delivered: true });
      return;
    }

    const approved = await gateway.controlGrant({
      action: "grant_request",
      grant: {
        teamId: userId,
        memberId: userId,
        deviceId: device.deviceId,
        appId: project.token,
        chatId,
        sourceTarget,
        grantId: randomUUID(),
        version: 1,
        expiresAt: 0,
        workdir: body.initialWorkdir || "",
        revoked: false,
        display: {
          teamName: "AI Studio",
          memberName: auth.user.displayName || auth.user.username || userId,
          appName: project.name,
          chatTitle: project.name,
          ...(body.initialWorkdir ? { initialWorkdir: body.initialWorkdir } : {}),
        },
      },
    });

    await upsertGrant({
      grantId: approved.grantId,
      teamId: userId,
      memberId: userId,
      appId: project.token,
      sourceTarget: approved.sourceTarget,
      chatId: approved.chatId,
      deviceId: device.deviceId,
      version: approved.version,
      expiresAt: approved.expiresAt,
      revoked: approved.revoked,
      locallyApproved: true,
      capabilities: ["exec"],
      workdir: approved.workdir,
      createdAt: new Date(),
    });

    res.status(200).json({ grant: approved, delivered: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "grant_outcome_unknown" });
  }
}
