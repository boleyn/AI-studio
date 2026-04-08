import { requireAuth } from "@server/auth/session";
import { getProjectAccessState } from "@server/projects/projectStorage";
import { createPutObjectPresignedUrl } from "@server/storage/s3";
import type { NextApiRequest, NextApiResponse } from "next";

import { getChatUploadRoot, isImageFile, toSafeFileName } from "../files/shared";

type ResponseBody =
  | {
      url: string;
      key: string;
      bucket: string;
      method: "PUT";
      headers: Record<string, string>;
    }
  | { error: string };

const getToken = (req: NextApiRequest) =>
  typeof req.body?.token === "string" ? req.body.token : "";

const getChatId = (req: NextApiRequest) =>
  typeof req.body?.chatId === "string" ? req.body.chatId : "";

const getFileName = (req: NextApiRequest) =>
  typeof req.body?.filename === "string" ? req.body.filename : "";

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const token = getToken(req).trim();
  const chatId = getChatId(req).trim();
  const filename = getFileName(req).trim();
  const contentType = typeof req.body?.contentType === "string" ? req.body.contentType : undefined;

  if (!token || !chatId || !filename) {
    res.status(400).json({ error: "缺少 token/chatId/filename 参数" });
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

  const safeName = toSafeFileName(filename);
  const prefix = getChatUploadRoot(token, chatId);
  const key = isImageFile(filename, contentType)
    ? `${prefix}/images/${safeName}`
    : `${prefix}/files/${safeName}`;

  try {
    const result = await createPutObjectPresignedUrl({
      key,
      contentType,
      bucketType: "private",
      expiresIn: 900,
    });

    res.status(200).json({
      url: result.url,
      key: result.key,
      bucket: result.bucket,
      method: result.method,
      headers: result.headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成上传地址失败";
    res.status(500).json({ error: message });
  }
}
