import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { localDeviceLeaseStore } from "./leaseStore";
import { findDevice } from "./store";

const TicketIdentitySchema = z
  .object({
    deviceId: z.string().uuid(),
    teamId: z.string().min(1),
    memberId: z.string().min(1),
    version: z.number().int().positive(),
    audience: z.string().min(1),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export const createDeviceTicketService = ({
  store = localDeviceLeaseStore,
  lookup = findDevice,
  clock = Date.now,
} = {}) => {
  const keyFor = (ticket: string) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error("invalid_device_ticket");
    return `local-device:connect-ticket:${createHash("sha256").update(ticket).digest("hex")}`;
  };

  const issue = async (input: { deviceId: string; audience: string }) => {
    const device = await lookup(input.deviceId);
    if (!device || device.revoked) throw new Error("device_unavailable");
    const identity = TicketIdentitySchema.parse({
      ...input,
      teamId: String(device.teamId),
      memberId: String(device.memberId),
      version: device.version,
      expiresAt: clock() + 300_000,
    });
    const ticket = randomBytes(32).toString("base64url");
    if (
      !(await store.acquireLease({
        key: keyFor(ticket),
        token: JSON.stringify(identity),
        ttlMs: 300_000,
      }))
    ) {
      throw new Error("device_ticket_collision");
    }
    return { ticket, expiresAt: identity.expiresAt };
  };

  const consume = async (input: { ticket: string; audience: string }) => {
    const key = keyFor(input.ticket);
    const raw = await store.get(key);
    if (raw === null) return null;
    const identity = (() => {
      try {
        return TicketIdentitySchema.parse(JSON.parse(raw));
      } catch {
        return null;
      }
    })();
    const now = clock();
    if (
      !identity ||
      identity.audience !== input.audience ||
      identity.expiresAt <= now ||
      identity.expiresAt > now + 300_000
    ) {
      return null;
    }
    const device = await lookup(identity.deviceId);
    if (
      !device ||
      device.revoked ||
      device.version !== identity.version ||
      String(device.teamId) !== identity.teamId ||
      String(device.memberId) !== identity.memberId
    ) {
      return null;
    }
    if (!(await store.releaseLease({ key, token: raw }))) return null;
    return identity;
  };

  return { issue, consume };
};
