import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import {
  LocalDeviceDescriptionSchema,
  type LocalDeviceDescription,
} from "@/shared/localDevice/type";
import { getDevicePublicKey } from "./identity";
import { claimPairing, findDevice, findPairing, insertDevice, insertPairing } from "./store";

export const startDevicePairing = async (input: LocalDeviceDescription & { publicKey: string }) => {
  const description = LocalDeviceDescriptionSchema.parse(input);
  const { key, fingerprint } = getDevicePublicKey(input.publicKey);
  const pollToken = randomBytes(32).toString("base64url");
  const pairingId = randomBytes(24).toString("base64url");
  const confirmationCode = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  await insertPairing({
    ...description,
    pairingId,
    deviceId: randomUUID(),
    fingerprint,
    publicKey: key.export({ type: "spki", format: "pem" }).toString(),
    pollTokenHash: createHash("sha256").update(pollToken).digest("hex"),
    confirmationCode,
    expiresAt,
    status: "pending",
  });
  return { pairingId, pollToken, confirmationCode, expiresAt: expiresAt.getTime() };
};

export const confirmDevicePairing = async (input: {
  pairingId: string;
  confirmationCode: string;
  deviceLabel?: string;
  userId: string;
}) => {
  const now = new Date();
  const record = await claimPairing({
    pairingId: input.pairingId,
    confirmationCode: input.confirmationCode,
    teamId: input.userId,
    memberId: input.userId,
    now,
  });
  if (!record) {
    const existing = await findPairing(input.pairingId);
    if (
      existing?.status === "confirmed" &&
      existing.expiresAt > now &&
      String(existing.teamId) === input.userId &&
      String(existing.memberId) === input.userId &&
      existing.confirmationCode === input.confirmationCode
    ) {
      return { deviceId: existing.deviceId };
    }
    throw new Error("pairing_unavailable");
  }
  const alreadyExists = await findDevice(record.deviceId);
  if (!alreadyExists) {
    await insertDevice({
      deviceId: record.deviceId,
      teamId: input.userId,
      memberId: input.userId,
      name: input.deviceLabel || record.name,
      platform: record.platform,
      publicKey: record.publicKey,
      fingerprint: record.fingerprint,
      version: 1,
      revoked: false,
      createdAt: now,
    });
  }
  return { deviceId: record.deviceId };
};

export const pollDevicePairing = async (input: { pairingId: string; pollToken: string }) => {
  const record = await findPairing(input.pairingId);
  const hash = createHash("sha256").update(input.pollToken).digest();
  const expected = Buffer.from(record?.pollTokenHash ?? "", "hex");
  if (
    !record ||
    expected.length !== hash.length ||
    !timingSafeEqual(hash, expected) ||
    record.expiresAt.getTime() <= Date.now()
  ) {
    throw new Error("pairing_unavailable");
  }
  return record.status === "confirmed"
    ? { status: "confirmed" as const, deviceId: record.deviceId }
    : { status: "pending" as const };
};
