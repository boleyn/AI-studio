import type { DeviceProof } from "@/shared/localDevice/type";
import { createDeviceProof, verifyDeviceProof } from "./identity";
import { localDeviceLeaseStore } from "./leaseStore";

export const createDeviceChallengeService = ({
  store = localDeviceLeaseStore,
  clock = Date.now,
} = {}) => {
  const keyFor = (challengeId: string) => {
    if (!/^[A-Za-z0-9_-]{32}$/.test(challengeId)) throw new Error("invalid_device_challenge");
    return `local-device:connect-challenge:${challengeId}`;
  };

  const issue = async (input: { deviceId: string; audience: string }) => {
    const proof = createDeviceProof({ ...input, now: clock() });
    const acquired = await store.acquireLease({
      key: keyFor(proof.challengeId),
      token: JSON.stringify(proof),
      ttlMs: 60_000,
    });
    if (!acquired) throw new Error("device_challenge_collision");
    return proof;
  };

  const consume = async (input: {
    challengeId: string;
    signature: string;
    publicKey: string;
    expectedDeviceId: string;
    audience: string;
  }): Promise<boolean> => {
    const key = keyFor(input.challengeId);
    const raw = await store.get(key);
    if (raw === null) return false;
    let proof: DeviceProof;
    try {
      proof = JSON.parse(raw) as DeviceProof;
    } catch {
      return false;
    }
    if (
      !proof ||
      proof.challengeId !== input.challengeId ||
      !verifyDeviceProof({
        ...input,
        proof,
        now: clock(),
      })
    ) {
      return false;
    }
    return store.releaseLease({ key, token: raw });
  };

  return { issue, consume };
};
