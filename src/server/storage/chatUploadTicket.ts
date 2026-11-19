import { createHmac, timingSafeEqual } from "node:crypto";

export function chatUploadSignature(key: string, type: string, expiry: string) {
  const secret = process.env.STORAGE_SECRET_ACCESS_KEY?.trim();
  if (!secret) throw new Error("文件存储未配置");
  return createHmac("sha256",secret).update(JSON.stringify(["chat-upload-v1",key,type,expiry])).digest("hex");
}

export function validChatUploadTicket(key: string, type: string, expiry: string, signature: string) {
  if (!/^\d{13}$/.test(expiry) || Number(expiry) <= Date.now() || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(chatUploadSignature(key,type,expiry),"hex"));
}
