import { requireAuth } from "@server/auth/session";
import { getProjectAccessState } from "@server/projects/projectStorage";
import { assertChatStoragePath, getObjectFromStorage, getStorageFileName } from "@server/storage/s3";
import type { NextApiRequest, NextApiResponse } from "next";
import { assertChatScopedStoragePath } from "./shared";

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
const getToken = (req: NextApiRequest): string | null => {
  const queryToken = typeof req.query.token === "string" ? req.query.token : null;
  const bodyToken = typeof req.body?.token === "string" ? req.body.token : null;
  return queryToken ?? bodyToken;
};
const getChatId = (req: NextApiRequest): string | null => {
  const queryChatId = typeof req.query.chatId === "string" ? req.query.chatId : null;
  const bodyChatId = typeof req.body?.chatId === "string" ? req.body.chatId : null;
  return queryChatId ?? bodyChatId;
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
    const token = getToken(req);
    if (!token || !token.trim()) {
      res.status(400).json({ error: "缺少 token 参数" });
      return;
    }
    const access = await getProjectAccessState(token, String(auth.user._id));
    if (access === "not_found") {
      res.status(404).json({ error: "项目不存在" });
      return;
    }
    if (access !== "ok") {
      res.status(403).json({ error: "无权访问该项目" });
      return;
    }
    const chatId = getChatId(req) || undefined;
    const scopedPath = assertChatScopedStoragePath({
      storagePath,
      token: token.trim(),
      chatId: chatId?.trim() || undefined,
    });
    const normalizedPath = assertChatStoragePath(scopedPath);
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
