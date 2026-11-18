import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";
import { getDevicePublicKey } from "@/server/localDevice/identity";
import { localDeviceLeaseStore } from "@/server/localDevice/leaseStore";
import type { DeviceRecord } from "@/server/localDevice/store";

const codeSchema = z.string().regex(/^[0-9a-f]{20}$/i);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create") }).strict(),
  z.object({ action: z.literal("preview"), code: codeSchema }).strict(),
  z.object({
    action: z.literal("redeem"), code: codeSchema, name: z.string().trim().min(1).max(120),
    platform: z.enum(["darwin", "windows", "linux"]), publicKey: z.string().max(1024),
  }).strict(),
]);
type Invite = { _id: string; owner: string; account: string; deviceId: string; expiresAt: Date; fingerprint?: string };
const digest = (code: string) => createHash("sha256").update(code.toUpperCase()).digest("hex");
export const config = { api: { bodyParser: { sizeLimit: "4kb" } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
  const body = parsed.data;
  const limit = await localDeviceLeaseStore.consumeFixedWindow({
    key: `device-invite:${body.action}:${req.socket.remoteAddress}`, windowSeconds: 60,
  });
  if (limit.currentCount > 30) return res.status(429).json({ error: "device_pair_rate_limited" });
  const db = await getMongoDb();
  const invites = db.collection<Invite>("local_device_invites");
  if (body.action === "create") {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const code = randomBytes(10).toString("hex").toUpperCase();
    await invites.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await invites.insertOne({ _id: digest(code), owner: String(auth.user._id), account: auth.user.username,
      deviceId: randomUUID(), expiresAt: new Date(Date.now() + 600_000) });
    return res.json({ code });
  }
  const match = { _id: digest(body.code), expiresAt: { $gt: new Date() } };
  if (body.action === "preview") {
    const invite = await invites.findOne({ ...match, fingerprint: { $exists: false } });
    if (!invite) return res.status(404).json({ error: "device_invite_unavailable" });
    return res.json({ account: invite.account, team: "伯仁", profile: { memberName: invite.account } });
  }
  let identity: ReturnType<typeof getDevicePublicKey>;
  try { identity = getDevicePublicKey(body.publicKey); }
  catch { return res.status(400).json({ error: "invalid_device_public_key" }); }
  // Reserve for this key before writing the device. A retry can finish either write.
  const invite = await invites.findOneAndUpdate(
    { ...match, $or: [{ fingerprint: { $exists: false } }, { fingerprint: identity.fingerprint }] },
    { $set: { fingerprint: identity.fingerprint } }, { returnDocument: "after" },
  );
  if (!invite) return res.status(409).json({ error: "device_invite_unavailable" });
  await db.collection<DeviceRecord>("local_devices").updateOne({ deviceId: invite.deviceId }, {
    $setOnInsert: { deviceId: invite.deviceId, teamId: invite.owner, memberId: invite.owner,
      name: body.name, platform: body.platform, publicKey: identity.key.export({ type: "spki", format: "pem" }).toString(),
      fingerprint: identity.fingerprint, createdAt: new Date(), revoked: false, version: 1 },
  }, { upsert: true });
  return res.json({ deviceId: invite.deviceId });
}
