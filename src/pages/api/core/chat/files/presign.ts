import { requireAuth } from "@server/auth/session";
import { buildChatFileViewUrl, createPutObjectPresignedUrl } from "@server/storage/s3";
import type { NextApiRequest, NextApiResponse } from "next";

import { isImageFile, MAX_FILES, MAX_FILE_SIZE, toSafeFileName, toSafeSegment } from "./shared";

interface PresignFileInput {
  id?: string;
  name: string;
  type?: string;
  size?: number;
  lastModified?: number;
}

interface PresignFileResult {
  id?: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  storagePath: string;
  publicUrl: string;
  markdownStoragePath?: string;
  markdownPublicUrl?: string;
  upload: {
    method: "PUT";
    url: string;
    headers: Record<string, string>;
  };
}

const getToken = (req: NextApiRequest): string | null =>
  typeof req.body?.token === "string" ? req.body.token : null;

const getChatId = (req: NextApiRequest): string | null =>
  typeof req.body?.chatId === "string" ? req.body.chatId : null;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ files: PresignFileResult[] } | { error: string }>
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

  const files = Array.isArray(req.body?.files) ? (req.body.files as PresignFileInput[]) : [];
  if (files.length === 0) {
    res.status(400).json({ error: "缺少 files 参数" });
    return;
  }
  if (files.length > MAX_FILES) {
    res.status(400).json({ error: `单次最多上传 ${MAX_FILES} 个文件` });
    return;
  }

  const now = Date.now();
  const chatRoot = `chat_uploads/${toSafeSegment(token)}/${toSafeSegment(chatId)}/.files`;

  const results = await Promise.all(
    files.map(async (file, index) => {
      const type = file.type || "application/octet-stream";
      const size = Number.isFinite(Number(file.size)) ? Number(file.size) : 0;
      if (size > MAX_FILE_SIZE) {
        throw new Error(`文件 ${file.name} 超过 ${MAX_FILE_SIZE / (1024 * 1024)}MB 限制`);
      }

      const safeName = toSafeFileName(file.name);
      const fileName = `${now}-${index}-${safeName}`;
      const storagePath = isImageFile(file.name, type)
        ? `${chatRoot}/images/${fileName}`
        : `${chatRoot}/files/${fileName}`;

      const presigned = await createPutObjectPresignedUrl({
        key: storagePath,
        contentType: type,
        bucketType: "private",
      });

      let markdownStoragePath: string | undefined;
      let markdownPublicUrl: string | undefined;
      if (!isImageFile(file.name, type)) {
        markdownStoragePath = `${chatRoot}/markdown/${fileName}.md`;
        markdownPublicUrl = buildChatFileViewUrl({ storagePath: markdownStoragePath });
      }

      return {
        id: typeof file.id === "string" ? file.id : undefined,
        name: file.name,
        type,
        size,
        lastModified: Number.isFinite(Number(file.lastModified)) ? Number(file.lastModified) : now,
        storagePath,
        publicUrl: buildChatFileViewUrl({ storagePath }),
        markdownStoragePath,
        markdownPublicUrl,
        upload: {
          method: "PUT" as const,
          url: presigned.url,
          headers: presigned.headers,
        },
      };
    })
  );

  res.status(200).json({ files: results });
}
