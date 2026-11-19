import type { NextApiResponse } from "next";

export async function sendConnectorDownload(body: ReadableStream<Uint8Array>, name: string, res: NextApiResponse) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const {value,done} = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 10 * 1024 * 1024) { await reader.cancel(); return res.status(413).json({error:"附件超过 10 MB。"}); }
    chunks.push(value);
  }
  res.setHeader("Content-Disposition","attachment; filename*=UTF-8''" + encodeURIComponent(name).replace(/['()*]/g,c=>"%" + c.charCodeAt(0).toString(16)));
  res.setHeader("Content-Type","application/octet-stream");
  res.setHeader("X-Content-Type-Options","nosniff");
  return res.send(Buffer.concat(chunks));
}
