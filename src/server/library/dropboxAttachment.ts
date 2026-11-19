import type { NextApiResponse } from "next";

const attachmentLimit = 10 * 1024 * 1024;

export async function sendDropboxAttachment(id: string, token: string, res: NextApiResponse) {
  const response = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Dropbox-API-Arg": JSON.stringify({ path: id }) },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    if (response.status === 409) return res.status(409).json({ error: "无法下载此 Dropbox 文件，请检查文件是否仍然可用。" });
    if (response.status === 429) return res.status(429).json({ error: "Dropbox 请求过于频繁，请稍后重试。" });
    return res.status(502).json({ error: "暂时无法读取 Dropbox 文件。" });
  }
  const metadata = JSON.parse(response.headers.get("Dropbox-API-Result") || "{}");
  if (typeof metadata.name !== "string" || !metadata.name) {
    await response.body.cancel();
    return res.status(502).json({ error: "Dropbox 未返回文件名称。" });
  }
  if (Number(metadata.size) > attachmentLimit) {
    await response.body.cancel();
    return res.status(413).json({ error: "附件超过 10 MB。" });
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > attachmentLimit) {
        await reader.cancel();
        return res.status(413).json({ error: "附件超过 10 MB。" });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const name = encodeURIComponent(metadata.name).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase());
  res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + name);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.send(Buffer.concat(chunks));
}
