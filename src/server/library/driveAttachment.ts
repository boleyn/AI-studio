import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { NextApiResponse } from "next";

const formats: Record<string, [string, string]> = {
  "application/vnd.google-apps.document": ["text/markdown", ".md"],
  "application/vnd.google-apps.spreadsheet": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  "application/vnd.google-apps.presentation": ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
};
const limit = 10 * 1024 * 1024;

function driveReadFailure(status: number, res: NextApiResponse) {
  switch (status) {
    case 401: return res.status(401).json({error:"Google Drive 授权已失效，请重新连接"});
    case 403: return res.status(403).json({error:"Google Drive 拒绝了读取请求，请检查文件权限"});
    case 404:
    case 410: return res.status(status).json({error:"文件可能已删除或共享已结束"});
    case 429: return res.status(429).json({error:"Google Drive 请求过于频繁，请稍后重试"});
    default: return res.status(502).json({error:"Google Drive 暂时无法读取文件，请稍后重试"});
  }
}

export async function sendDriveAttachment(id: string, accessToken: string, res: NextApiResponse, download = false) {
  const base = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id);
  const headers = {Authorization: "Bearer " + accessToken};
  const meta = await fetch(base + "?supportsAllDrives=true&fields=name,mimeType,size,trashed,capabilities(canDownload)", {headers});
  if (!meta.ok) return driveReadFailure(meta.status, res);
  const file = await meta.json();
  if (file.trashed || !file.capabilities?.canDownload) return res.status(403).json({error:"没有下载此文件的权限"});
  const format = formats[file.mimeType];
  // Workspace exports can be smaller or larger than their native Drive representation.
  if (!download && !format && Number(file.size) > limit) return res.status(413).json({error:"附件超过 10 MB"});
  if (!format && file.mimeType.startsWith("application/vnd.google-apps.")) return res.status(415).json({error:"此文件类型暂不支持引用"});
  const url = format ? base + "/export?" + new URLSearchParams({mimeType:format[0]}) : base + "?alt=media&supportsAllDrives=true";
  const content = await fetch(url,{headers});
  if (!content.ok || !content.body) return driveReadFailure(content.status, res);
  const name = format && !file.name.toLowerCase().endsWith(format[1]) ? file.name + format[1] : file.name;
  res.setHeader("Content-Disposition","attachment; filename*=UTF-8''" + encodeURIComponent(name));
  res.setHeader("Content-Type","application/octet-stream");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Attachment-Type",format?.[0] || file.mimeType);
  if (download) {
    await pipeline(Readable.fromWeb(content.body as NodeReadableStream<Uint8Array>), res);
    return;
  }
  const reader = content.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const read = await reader.read();
    if (read.done) break;
    size += read.value.length;
    if (size > limit) {
      await reader.cancel();
      res.removeHeader("Content-Disposition");
      res.removeHeader("Content-Type");
      return res.status(413).json({error:"附件超过 10 MB"});
    }
    chunks.push(read.value);
  }
  return res.send(Buffer.concat(chunks));
}
