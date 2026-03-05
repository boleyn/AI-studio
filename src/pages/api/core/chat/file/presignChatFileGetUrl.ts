import { requireAuth } from "@server/auth/session";
import { createGetObjectPresignedUrl, normalizeStorageKey } from "@server/storage/s3";
import type { NextApiRequest, NextApiResponse } from "next";

import { getTokenUploadPrefix } from "../files/shared";

const getToken = (req: NextApiRequest) =>
  typeof req.body?.token === "string" ? req.body.token : "";

const getKey = (req: NextApiRequest) => {
  if (typeof req.body?.key === "string") return req.body.key;
  if (typeof req.body?.storagePath === "string") return req.body.storagePath;
  return "";
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<string | { error: string }>
) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const token = getToken(req).trim();
  const keyInput = getKey(req).trim();
  if (!keyInput) {
    res.status(400).json({ error: "缺少 key 参数" });
    return;
  }

  let key = "";
  try {
    key = normalizeStorageKey(keyInput);
  } catch {
    res.status(400).json({ error: "key 非法" });
    return;
  }

  if (token) {
    const expectedPrefix = `${getTokenUploadPrefix(token)}/`;
    if (!key.startsWith(expectedPrefix)) {
      res.status(403).json({ error: "无权限访问该文件" });
      return;
    }
  }

  try {
    const { url } = await createGetObjectPresignedUrl({
      key,
      bucketType: "private",
      expiresIn: 3600,
    });
    res.status(200).json(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成访问地址失败";
    res.status(500).json({ error: message });
  }
}
