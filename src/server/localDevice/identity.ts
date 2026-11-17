import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { DeviceProofSchema, type DeviceProof } from "@/shared/localDevice/type";

/**
 * 生成短时设备持钥挑战。调用方须持久化并原子消费 challengeId，
 * 这里只验证签名，不能单独用于防重放或代替设备归属/撤销校验。
 */
export const createDeviceProof = (input: {
  deviceId: string;
  audience: string;
  now: number;
}): DeviceProof =>
  DeviceProofSchema.parse({
    purpose: "local-device-connect-v1",
    challengeId: randomBytes(24).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    deviceId: input.deviceId,
    audience: input.audience,
    expiresAt: input.now + 60_000,
  });

/** 固定字段顺序和编码，Go 连接器按相同 JSON 字段数组签名，避免对象序列化差异。 */
export const encodeDeviceProof = (proof: DeviceProof): Buffer => {
  const parsed = DeviceProofSchema.parse(proof);
  return Buffer.from(
    JSON.stringify([
      parsed.purpose,
      parsed.challengeId,
      parsed.nonce,
      parsed.deviceId,
      parsed.audience,
      parsed.expiresAt,
    ]),
    "utf8",
  );
};

/** 仅接受 Ed25519 SPKI 公钥；规范化 DER 后计算指纹，不接受私钥或任意算法。 */
export const getDevicePublicKey = (publicKey: string) => {
  if (
    publicKey.length > 1024 ||
    !publicKey.startsWith("-----BEGIN PUBLIC KEY-----") ||
    !publicKey.trimEnd().endsWith("-----END PUBLIC KEY-----")
  ) {
    throw new Error("invalid_device_public_key");
  }
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("invalid_device_key_algorithm");
  const der = key.export({ type: "spki", format: "der" });
  return {
    key,
    fingerprint: createHash("sha256").update(der).digest("base64url"),
  };
};

/**
 * 验证数据库中原始挑战对应的签名。expectedDeviceId/audience 来自服务端配置，
 * 不采信客户端提交的挑战内容；过期、异常编码、错误密钥统一返回 false。
 */
export const verifyDeviceProof = (input: {
  proof: DeviceProof;
  signature: string;
  publicKey: string;
  expectedDeviceId: string;
  audience: string;
  now: number;
}): boolean => {
  try {
    const proof = DeviceProofSchema.parse(input.proof);
    if (
      !Number.isFinite(input.now) ||
      proof.expiresAt <= input.now ||
      proof.expiresAt > input.now + 60_000 ||
      proof.deviceId !== input.expectedDeviceId ||
      proof.audience !== input.audience ||
      !/^[A-Za-z0-9_-]{86}$/.test(input.signature)
    ) {
      return false;
    }
    const signature = Buffer.from(input.signature, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== input.signature) {
      return false;
    }
    return verify(null, encodeDeviceProof(proof), getDevicePublicKey(input.publicKey).key, signature);
  } catch {
    return false;
  }
};
