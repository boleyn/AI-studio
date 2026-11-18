import { requestProjectGrant } from "@/server/localDevice/requestProjectGrant";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAuth } from "@server/auth/session";
import { getProject } from "@server/projects/projectStorage";
import { createLocalDeviceGateway } from "@/server/localDevice/gateway";
import {
  findGrant,
  listGrantsForScope,
  markGrantRevoked,
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

  try {
    const grant = await requestProjectGrant({
      userId,
      memberName: auth.user.displayName || auth.user.username || userId,
      project,
      deviceId: body.deviceId,
      chatId: body.chatId,
      initialWorkdir: body.initialWorkdir,
    });
    res.status(200).json({ grant, delivered: true });
  } catch (err) {
    const error = err instanceof Error ? err.message : "grant_outcome_unknown";
    res.status(error === "device_not_found" ? 404 : 400).json({ error });
  }
}
