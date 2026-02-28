import { requireAuth } from "@server/auth/session";
import { assertChatStoragePath, getObjectFromStorage, getStorageFileName } from "@server/storage/s3";
import type { NextApiRequest, NextApiResponse } from "next";

const getStoragePath = (req: NextApiRequest): string | null => {
  const queryPath = typeof req.query.storagePath === "string" ? req.query.storagePath : null;
  const bodyPath = typeof req.body?.storagePath === "string" ? req.body.storagePath : null;
  return queryPath ?? bodyPath;
};

const parseDownloadFlag = (value: unknown) => {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const storagePath = getStoragePath(req);
  if (!storagePath) {
    res.status(400).json({ error: "缺少 storagePath 参数" });
    return;
  }

  const download = parseDownloadFlag(req.query.download);

  try {
    const normalizedPath = assertChatStoragePath(storagePath);
    const { buffer, contentType, contentLength } = await getObjectFromStorage({
      key: normalizedPath,
      bucketType: "private",
    });

    const fileName = getStorageFileName(normalizedPath);
    const dispositionType = download ? "attachment" : "inline";

    res.setHeader("Content-Type", contentType || "application/octet-stream");
    res.setHeader("Content-Length", String(contentLength || buffer.byteLength));
    res.setHeader("Content-Disposition", `${dispositionType}; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.status(200).send(buffer);
  } catch {
    res.status(404).json({ error: "文件不存在或读取失败" });
  }
}
