import { sendConnectorDownload } from "@server/library/sendConnectorDownload";
import type { NextApiRequest, NextApiResponse } from "next";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";

type Connection = { _id: string; token: string; refreshingUntil?: Date };
type Entry = { id: string; name: string; type: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.setHeader("Allow", "GET").status(405).end();
  const { folder = "", cursor = "", file, query = "" } = req.query;
  if (typeof folder !== "string" || !/^\d*$/.test(folder) || typeof cursor !== "string" ||
      typeof query !== "string" || (file !== undefined && (typeof file !== "string" || !/^\d+$/.test(file)))) return res.status(400).end();
  const search = query.trim();
  if (search && !/^\d{0,4}$/.test(cursor)) return res.status(400).end();
  const owner = String(auth.user._id);
  const connections = (await getMongoDb()).collection<Connection>("library_box_connections");
  const now = new Date();
  const lease = new Date(now.getTime() + 45000);
  const connection = await connections.findOneAndUpdate({_id:owner, $or:[{refreshingUntil:{$exists:false}}, {refreshingUntil:{$lte:now}}]},
    {$set:{refreshingUntil:lease}}, {returnDocument:"after"});
  if (!connection) return res.status(409).json({error:await connections.findOne({_id:owner},{projection:{_id:1}}) ? "Box 正在刷新连接，请重试。" : "请先连接 Box。"});
  const lock = {_id:owner, token:connection.token, refreshingUntil:lease};
  try {
    const key = Buffer.from(process.env.LIBRARY_CONNECTOR_KEY || "", "base64");
    const aad = Buffer.from("box:" + owner);
    const bytes = Buffer.from(connection.token, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0,12));
    decipher.setAAD(aad);
    decipher.setAuthTag(bytes.subarray(12,28));
    const refresh = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString();
    const renewed = await fetch("https://api.box.com/oauth2/token", {method:"POST", signal:AbortSignal.timeout(20000),
      body:new URLSearchParams({grant_type:"refresh_token",refresh_token:refresh,client_id:process.env.BOX_CLIENT_ID || "",client_secret:process.env.BOX_CLIENT_SECRET || ""})});
    const tokens = await renewed.json();
    if (!renewed.ok || !tokens.refresh_token || !tokens.access_token) return res.status(502).json({error:"Box 授权刷新失败，请重新连接。"});
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(tokens.refresh_token,"utf8"),cipher.final()]);
    const rotated = await connections.updateOne(lock,{$set:{token:Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString("base64")},$unset:{refreshingUntil:""}});
    if (!rotated.matchedCount) return res.status(409).json({error:"Box 连接已更改，请重试。"});
    const headers = {Authorization:"Bearer " + tokens.access_token};
    const base = "https://api.box.com/2.0";
    if (file) {
      const info = await fetch(base + "/files/" + file + "?fields=name,size",{headers});
      if (!info.ok) return res.status(404).json({error:"无法访问此 Box 文件。"});
      const metadata = await info.json();
      if (metadata.size > 10 * 1024 * 1024) return res.status(413).json({error:"附件超过 10 MB。"});
      const download = await fetch(base + "/files/" + file + "/content",{headers});
      if (download.status !== 200 || !download.body) return res.status(502).json({error:"Box 文件暂时无法下载，请重试。"});
      return await sendConnectorDownload(download.body, metadata.name, res);
    }
    const params = new URLSearchParams({fields:"id,name,type",limit:"100"});
    if (search) { params.set("query",search); params.set("offset",cursor || "0"); }
    else { params.set("usemarker","true"); if (cursor) params.set("marker",cursor); }
    const listing = await fetch(base + (search ? "/search" : "/folders/" + (folder || "0") + "/items") + "?" + params,{headers});
    if (!listing.ok) return res.status(listing.status === 429 ? 429 : 502).json({error:"暂时无法读取 Box 文件，请重试。"});
    const page = await listing.json();
    const files = (page.entries as Entry[]).filter(e=>e.type==="folder" || e.type==="file").map(e=>({id:e.id,name:e.name,folder:e.type==="folder"}));
    const offset = Number(cursor) + 100;
    return res.json({files,nextCursor:search ? (offset < page.total_count && offset < 10000 ? String(offset) : undefined) : page.next_marker || undefined});
  } catch {
    return res.status(502).json({error:"Box 文件服务暂时不可用。"});
  } finally {
    await connections.updateOne(lock,{$unset:{refreshingUntil:""}});
  }
}
