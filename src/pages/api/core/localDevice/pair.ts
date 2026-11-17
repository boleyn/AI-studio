import { createHash } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAuth } from "@server/auth/session";
import { localDeviceLeaseStore } from "@/server/localDevice/leaseStore";
import {
  confirmDevicePairing,
  pollDevicePairing,
  startDevicePairing,
} from "@/server/localDevice/pairing";

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };

const PairBodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      name: z.string().trim().min(1).max(120),
      platform: z.enum(["darwin", "linux", "windows"]),
      publicKey: z.string().min(1).max(1024),
    })
    .strict(),
  z
    .object({
      action: z.literal("poll"),
      pairingId: z.string().min(1).max(128),
      pollToken: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      action: z.literal("confirm"),
      pairingId: z.string().min(1).max(128),
      confirmationCode: z.string().regex(/^\d{6}$/),
      deviceLabel: z.string().trim().min(1).max(120).optional(),
    })
    .strict(),
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const parsed = PairBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const body = parsed.data;

  if (body.action === "confirm") {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const userId = auth.user._id != null ? String(auth.user._id) : "";
    if (!userId) {
      res.status(401).json({ error: "用户身份无效" });
      return;
    }
    try {
      const result = await confirmDevicePairing({
        pairingId: body.pairingId,
        confirmationCode: body.confirmationCode,
        deviceLabel: body.deviceLabel,
        userId,
      });
      res.status(200).json({ action: "confirm", ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "pairing_unavailable" });
    }
    return;
  }

  const ip =
    (typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"].split(",")[0] : "") ||
    req.socket?.remoteAddress ||
    "unknown";
  const ipHash = createHash("sha256").update(ip).digest("hex");
  const { currentCount } = await localDeviceLeaseStore.consumeFixedWindow({
    key: `local-device:pair:${body.action}:${ipHash}`,
    windowSeconds: 60,
  });
  if (currentCount > (body.action === "start" ? 10 : 120)) {
    res.status(429).json({ error: "device_pair_rate_limited" });
    return;
  }

  if (body.action === "start") {
    try {
      const started = await startDevicePairing(body);
      res.status(200).json({ action: "start", ...started });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "invalid_device_public_key" });
    }
    return;
  }

  const { currentCount: pollCount } = await localDeviceLeaseStore.consumeFixedWindow({
    key: `local-device:pair:poll:${body.pairingId}`,
    windowSeconds: 60,
  });
  if (pollCount > 30) {
    res.status(429).json({ error: "device_pair_rate_limited" });
    return;
  }
  try {
    const result = await pollDevicePairing(body);
    res.status(200).json({ action: "poll", result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "pairing_unavailable" });
  }
}
