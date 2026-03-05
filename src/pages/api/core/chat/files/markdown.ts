import { requireAuth } from "@server/auth/session";
import { assertChatStoragePath, getObjectFromStorage } from "@server/storage/s3";
import type { NextApiRequest, NextApiResponse } from "next";
import { assertChatScopedStoragePath } from "./shared";

const getStoragePath = (req: NextApiRequest): string | null => {
  const queryPath = typeof req.query.storagePath === "string" ? req.query.storagePath : null;
  const bodyPath = typeof req.body?.storagePath === "string" ? req.body.storagePath : null;
  return queryPath ?? bodyPath;
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ markdown: string } | { error: string }>
) {
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

  try {
    const token = getToken(req);
    const chatId = getChatId(req) || undefined;
    const scopedPath =
      token && token.trim()
        ? assertChatScopedStoragePath({
            storagePath,
            token: token.trim(),
            chatId: chatId?.trim() || undefined,
          })
        : storagePath;
    const normalizedPath = assertChatStoragePath(scopedPath);
    const { buffer } = await getObjectFromStorage({
      key: normalizedPath,
      bucketType: "private",
    });
    const markdown = buffer.toString("utf8");
    res.status(200).json({ markdown });
  } catch {
    res.status(404).json({ error: "文件不存在或读取失败" });
  }
}
