import { createHash } from "node:crypto";
import type { Server } from "node:http";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { LOCAL_DEVICE_GATEWAY_AUDIENCE } from "@/shared/localDevice/constants";
import { createDeviceChallengeService } from "@/server/localDevice/challenge";
import { localDeviceLeaseStore } from "@/server/localDevice/leaseStore";
import { getEmbeddedDeviceGateway } from "@/server/localDevice/socket";
import { findDevice } from "@/server/localDevice/store";
import { createDeviceTicketService } from "@/server/localDevice/ticket";

export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };

const ConnectBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("challenge"), deviceId: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal("exchange"),
      deviceId: z.string().uuid(),
      challengeId: z.string().min(1).max(128),
      signature: z.string().min(1).max(256),
    })
    .strict(),
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const server = (res.socket as (typeof res.socket & { server?: Server }) | null)?.server;
  if (server) getEmbeddedDeviceGateway().attach(server);

  const parsed = ConnectBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const body = parsed.data;
  const ip =
    (typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"].split(",")[0] : "") ||
    req.socket?.remoteAddress ||
    "unknown";
  const ipHash = createHash("sha256").update(ip).digest("hex");

  for (const [scope, limit] of [
    [`ip:${ipHash}`, 120],
    [`device:${body.deviceId}`, 20],
  ] as const) {
    const { currentCount } = await localDeviceLeaseStore.consumeFixedWindow({
      key: `local-device:connect:${scope}`,
      windowSeconds: 60,
    });
    if (currentCount > limit) {
      res.status(429).json({ error: "device_auth_rate_limited" });
      return;
    }
  }

  const device = await findDevice(body.deviceId);
  if (!device || device.revoked) {
    res.status(401).json({ error: "device_auth_failed" });
    return;
  }

  const challenges = createDeviceChallengeService();
  const audience = LOCAL_DEVICE_GATEWAY_AUDIENCE;

  if (body.action === "challenge") {
    const proof = await challenges.issue({ deviceId: device.deviceId, audience });
    res.status(200).json({ action: "challenge", proof });
    return;
  }

  const verified = await challenges.consume({
    challengeId: body.challengeId,
    signature: body.signature,
    publicKey: device.publicKey,
    expectedDeviceId: device.deviceId,
    audience,
  });
  if (!verified) {
    res.status(401).json({ error: "device_auth_failed" });
    return;
  }

  const issued = await createDeviceTicketService().issue({ deviceId: device.deviceId, audience });
  res.status(200).json({
    action: "exchange",
    ...issued,
    profile: {
      account: String(device.memberId),
      team: "AI Studio",
    },
  });
}
