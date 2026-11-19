import type { NextApiRequest, NextApiResponse } from "next";
import { validChatUploadTicket } from "@server/storage/chatUploadTicket";
import { assertChatStoragePath, uploadObjectToStorage } from "@server/storage/s3";
import { MAX_FILE_SIZE } from "./shared";

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control","no-store");
  if (req.method !== "PUT") return res.setHeader("Allow","PUT").status(405).end();
  const { key, type, expiry, signature } = req.query;
  if (typeof key !== "string" || typeof type !== "string" || typeof expiry !== "string" || typeof signature !== "string" ||
      !validChatUploadTicket(key,type,expiry,signature)) return res.status(403).end();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_FILE_SIZE) return res.status(413).end();
    chunks.push(buffer);
  }
  await uploadObjectToStorage({key:assertChatStoragePath(key),body:Buffer.concat(chunks,size),contentType:type});
  return res.status(204).end();
}
