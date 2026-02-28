import { requireAuth } from "@server/auth/session";
import { buildChatFileViewUrl, uploadObjectToStorage } from "@server/storage/s3";
import type { NextApiRequest, NextApiResponse } from "next";

import { isImageFile, MAX_FILES, MAX_FILE_SIZE } from "./shared";
import { pendingParseInfo, type UploadFileResult } from "./types";

interface UploadFileInput {
  id?: string;
  name: string;
  type?: string;
  size?: number;
  lastModified?: number;
  storagePath: string;
  markdownStoragePath?: string;
}

const getToken = (req: NextApiRequest): string | null =>
  typeof req.body?.token === "string" ? req.body.token : null;

const getChatId = (req: NextApiRequest): string | null =>
  typeof req.body?.chatId === "string" ? req.body.chatId : null;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ files: UploadFileResult[] } | { error: string }>
) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const token = getToken(req);
  const chatId = getChatId(req);
  if (!token || !chatId) {
    res.status(400).json({ error: "缺少 token 或 chatId 参数" });
    return;
  }

  const files = Array.isArray(req.body?.files) ? (req.body.files as UploadFileInput[]) : [];
  if (files.length === 0) {
    res.status(400).json({ error: "缺少 files 参数" });
    return;
  }
  if (files.length > MAX_FILES) {
    res.status(400).json({ error: `单次最多上传 ${MAX_FILES} 个文件` });
    return;
  }

  const now = Date.now();
  const results: UploadFileResult[] = [];

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (!file || typeof file.name !== "string" || typeof file.storagePath !== "string") {
      continue;
    }

    if (!file.storagePath.startsWith("chat_uploads/")) {
      res.status(400).json({ error: `文件 ${file.name} 路径非法` });
      return;
    }

    const size = Number.isFinite(Number(file.size)) ? Number(file.size) : 0;
    if (size > MAX_FILE_SIZE) {
      res.status(400).json({ error: `文件 ${file.name} 超过 ${MAX_FILE_SIZE / (1024 * 1024)}MB 限制` });
      return;
    }

    const type = file.type || "application/octet-stream";
    const storagePath = file.storagePath;

    let markdownStoragePath: string | undefined;
    let markdownPublicUrl: string | undefined;
    if (!isImageFile(file.name, type) && file.markdownStoragePath) {
      markdownStoragePath = file.markdownStoragePath;
      await uploadObjectToStorage({
        key: markdownStoragePath,
        body: "",
        contentType: "text/markdown; charset=utf-8",
        bucketType: "private",
      });
      markdownPublicUrl = buildChatFileViewUrl({
        storagePath: markdownStoragePath,
      });
    }

    const publicUrl = buildChatFileViewUrl({
      storagePath,
    });

    results.push({
      id: typeof file.id === "string" ? file.id : undefined,
      name: file.name,
      type,
      size,
      lastModified: Number.isFinite(Number(file.lastModified)) ? Number(file.lastModified) : now,
      storagePath,
      publicUrl,
      markdownStoragePath,
      markdownPublicUrl,
      parse: pendingParseInfo,
    });
  }

  res.status(200).json({ files: results });
}
