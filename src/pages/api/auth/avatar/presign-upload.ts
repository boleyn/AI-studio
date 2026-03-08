import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { buildPublicObjectUrl, createPutObjectPresignedUrl } from "@server/storage/s3";
import { toSafeFileName } from "../../core/chat/files/shared";

type ResponseBody =
  | {
      url: string;
      key: string;
      bucket: string;
      method: "PUT";
      headers: Record<string, string>;
      publicUrl: string;
    }
  | { error: string };

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/svg+xml",
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const filename = typeof req.body?.filename === "string" ? req.body.filename.trim() : "";
  const contentType = typeof req.body?.contentType === "string" ? req.body.contentType.trim() : "";

  if (!filename || !contentType) {
    res.status(400).json({ error: "缺少 filename/contentType 参数" });
    return;
  }
  if (!ALLOWED_TYPES.has(contentType.toLowerCase())) {
    res.status(400).json({ error: "不支持的头像格式" });
    return;
  }

  const safeName = toSafeFileName(filename);
  const ext = safeName.includes(".") ? safeName.split(".").pop() : "png";
  const key = `user_avatars/${String(auth.user._id)}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}.${ext}`;

  try {
    const put = await createPutObjectPresignedUrl({
      key,
      contentType,
      bucketType: "public",
      expiresIn: 900,
    });
    const publicUrl = buildPublicObjectUrl({ key: put.key, bucketType: "public" });

    res.status(200).json({
      url: put.url,
      key: put.key,
      bucket: put.bucket,
      method: put.method,
      headers: put.headers,
      publicUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成上传地址失败";
    res.status(500).json({ error: message });
  }
}
