import type { Server } from "node:http";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAuth } from "@server/auth/session";
import { createLocalDeviceGateway } from "@/server/localDevice/gateway";
import { getEmbeddedDeviceGateway } from "@/server/localDevice/socket";
import {
  listUserDevices,
  renameDevice,
  revokeDevice,
} from "@/server/localDevice/store";

const ManageActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z
    .object({
      action: z.literal("rename"),
      deviceId: z.string().uuid(),
      name: z.string().trim().min(1).max(120),
    })
    .strict(),
  z
    .object({
      action: z.literal("revoke"),
      deviceId: z.string().uuid(),
    })
    .strict(),
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const userId = auth.user._id != null ? String(auth.user._id) : "";
  if (!userId) {
    res.status(401).json({ error: "用户身份无效" });
    return;
  }

  const server = (res.socket as (typeof res.socket & { server?: Server }) | null)?.server;
  if (server) getEmbeddedDeviceGateway().attach(server);

  if (req.method === "GET") {
    const devices = await listUserDevices(userId);
    let onlineMap = new Map<string, boolean>();
    if (devices.length > 0) {
      const gateway = createLocalDeviceGateway();
      const presence = await gateway
        .presence({
          teamId: userId,
          memberId: userId,
          deviceIds: devices.map((d) => d.deviceId),
        })
        .catch(() => []);
      onlineMap = new Map(presence.map((p) => [p.deviceId, p.online]));
    }
    res.status(200).json({
      devices: devices.map((d) => ({
        deviceId: d.deviceId,
        name: d.name,
        platform: d.platform,
        fingerprint: d.fingerprint,
        online: onlineMap.get(d.deviceId) ?? false,
        createdAt: d.createdAt,
      })),
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const parsed = ManageActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const body = parsed.data;

  if (body.action === "list") {
    const devices = await listUserDevices(userId);
    let onlineMap = new Map<string, boolean>();
    if (devices.length > 0) {
      const gateway = createLocalDeviceGateway();
      const presence = await gateway
        .presence({
          teamId: userId,
          memberId: userId,
          deviceIds: devices.map((d) => d.deviceId),
        })
        .catch(() => []);
      onlineMap = new Map(presence.map((p) => [p.deviceId, p.online]));
    }
    res.status(200).json({
      devices: devices.map((d) => ({
        deviceId: d.deviceId,
        name: d.name,
        platform: d.platform,
        fingerprint: d.fingerprint,
        online: onlineMap.get(d.deviceId) ?? false,
        createdAt: d.createdAt,
      })),
    });
    return;
  }

  if (body.action === "rename") {
    const updated = await renameDevice(body.deviceId, userId, body.name);
    if (!updated) {
      res.status(404).json({ error: "device_not_found" });
      return;
    }
    res.status(200).json({ success: true });
    return;
  }

  const revoked = await revokeDevice(body.deviceId, userId);
  if (!revoked) {
    res.status(404).json({ error: "device_not_found" });
    return;
  }
  await createLocalDeviceGateway()
    .disconnect({ teamId: userId, memberId: userId, deviceId: body.deviceId })
    .catch(() => {});
  res.status(200).json({ success: true });
}
