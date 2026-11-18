import type { Collection } from "mongodb";
import { getMongoDb } from "../db/mongo";

export type DevicePlatform = "darwin" | "linux" | "windows";

export type DeviceRecord = {
  deviceId: string;
  teamId: string;
  memberId: string;
  name: string;
  remark?: string;
  platform: DevicePlatform;
  publicKey: string;
  fingerprint: string;
  version: number;
  revoked: boolean;
  createdAt: Date;
};

export type PairingRecord = {
  pairingId: string;
  deviceId: string;
  name: string;
  platform: DevicePlatform;
  publicKey: string;
  fingerprint: string;
  pollTokenHash: string;
  confirmationCode: string;
  expiresAt: Date;
  status: "pending" | "confirmed";
  teamId?: string;
  memberId?: string;
};

export type GrantRecord = {
  grantId: string;
  teamId: string;
  memberId: string;
  appId: string;
  sourceTarget: string;
  chatId: string;
  deviceId: string;
  version: number;
  expiresAt: number;
  revoked: boolean;
  locallyApproved: boolean;
  capabilities: Array<"exec">;
  workdir: string;
  createdAt: Date;
  purgeAt?: Date;
};

let indexesReady = false;

async function getCollections() {
  const db = await getMongoDb();
  const devices = db.collection<DeviceRecord>("local_devices");
  const pairings = db.collection<PairingRecord>("local_device_pairings");
  const grants = db.collection<GrantRecord>("local_device_grants");

  if (!indexesReady) {
    indexesReady = true;
    await Promise.all([
      devices.createIndex({ deviceId: 1 }, { unique: true }),
      devices.createIndex({ teamId: 1, memberId: 1, createdAt: -1 }),
      pairings.createIndex({ pairingId: 1 }, { unique: true }),
      pairings.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      grants.createIndex({ grantId: 1 }, { unique: true }),
      grants.createIndex({ teamId: 1, memberId: 1, appId: 1, chatId: 1 }),
      grants.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
    ]).catch((err) => {
      indexesReady = false;
      console.warn("[localDevice] ensure indexes failed:", err);
    });
  }

  return { devices, pairings, grants };
}

export async function findDevice(deviceId: string): Promise<DeviceRecord | null> {
  const { devices } = await getCollections();
  return devices.findOne({ deviceId });
}

export async function listUserDevices(userId: string): Promise<DeviceRecord[]> {
  const { devices } = await getCollections();
  return devices
    .find({ teamId: userId, memberId: userId, revoked: false })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function insertDevice(record: DeviceRecord): Promise<void> {
  const { devices } = await getCollections();
  await devices.insertOne(record);
}

export async function renameDevice(deviceId: string, userId: string, name: string): Promise<boolean> {
  const { devices } = await getCollections();
  const res = await devices.updateOne(
    { deviceId, teamId: userId, memberId: userId, revoked: false },
    { $set: { name } },
  );
  return res.matchedCount > 0;
}

export async function setDeviceRemark(deviceId: string, userId: string, remark: string) {
  const { devices } = await getCollections();
  const result = await devices.updateOne({ deviceId, teamId: userId, memberId: userId, revoked: false }, { $set: { remark } });
  return result.matchedCount > 0;
}

export async function revokeDevice(deviceId: string, userId: string): Promise<boolean> {
  const { devices, grants } = await getCollections();
  const res = await devices.updateOne(
    { deviceId, teamId: userId, memberId: userId, revoked: false },
    { $set: { revoked: true }, $inc: { version: 1 } },
  );
  if (res.matchedCount > 0) {
    await grants.updateMany(
      { deviceId, teamId: userId, memberId: userId, revoked: false },
      { $set: { revoked: true }, $inc: { version: 1 } },
    );
    return true;
  }
  return false;
}

export async function insertPairing(record: PairingRecord): Promise<void> {
  const { pairings } = await getCollections();
  await pairings.insertOne(record);
}

export async function findPairing(pairingId: string): Promise<PairingRecord | null> {
  const { pairings } = await getCollections();
  return pairings.findOne({ pairingId });
}

export async function claimPairing(input: {
  pairingId: string;
  confirmationCode: string;
  teamId: string;
  memberId: string;
  now: Date;
}): Promise<PairingRecord | null> {
  const { pairings } = await getCollections();
  return pairings.findOneAndUpdate(
    {
      pairingId: input.pairingId,
      confirmationCode: input.confirmationCode,
      status: "pending",
      expiresAt: { $gt: input.now },
    },
    {
      $set: {
        status: "confirmed",
        teamId: input.teamId,
        memberId: input.memberId,
      },
    },
    { returnDocument: "after" },
  );
}

export async function findGrant(grantId: string): Promise<GrantRecord | null> {
  const { grants } = await getCollections();
  return grants.findOne({ grantId });
}

export async function listGrantsForScope(input: {
  userId: string;
  appId: string;
  deviceId?: string;
}): Promise<GrantRecord[]> {
  const { grants } = await getCollections();
  return grants
    .find({
      teamId: input.userId,
      memberId: input.userId,
      appId: input.appId,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      revoked: false,
    })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function upsertGrant(record: GrantRecord): Promise<void> {
  const { grants } = await getCollections();
  await grants.updateOne(
    { grantId: record.grantId },
    { $set: record },
    { upsert: true },
  );
}

export async function markGrantRevoked(grantId: string, userId: string): Promise<GrantRecord | null> {
  const { grants } = await getCollections();
  return grants.findOneAndUpdate(
    { grantId, teamId: userId, memberId: userId },
    { $set: { revoked: true }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
}
