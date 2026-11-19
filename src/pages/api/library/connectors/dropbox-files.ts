import type { NextApiRequest, NextApiResponse } from "next";
import { createDecipheriv } from "node:crypto";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";

interface DropboxEntry {
  ".tag": string;
  id: string;
  name: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.setHeader("Allow", "GET").status(405).end();
  const { folder = "", cursor } = req.query;
  if (typeof folder !== "string" || (folder && !/^id:[\w-]+$/.test(folder)) ||
      (cursor !== undefined && typeof cursor !== "string")) return res.status(400).end();

  const owner = String(auth.user._id);
  const db = await getMongoDb();
  const connection = await db.collection<{ _id: string; token: string }>("library_dropbox_connections").findOne({ _id: owner });
  if (!connection) return res.status(409).json({ error: "请先连接 Dropbox。" });
  try {
    const bytes = Buffer.from(connection.token, "base64");
    const key = Buffer.from(process.env.LIBRARY_CONNECTOR_KEY || "", "base64");
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from("dropbox:" + owner));
    cipher.setAuthTag(bytes.subarray(12, 28));
    const refresh = Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
    const tokenResponse = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST", body: new URLSearchParams({
        grant_type: "refresh_token", refresh_token: refresh,
        client_id: process.env.DROPBOX_CLIENT_ID || "", client_secret: process.env.DROPBOX_CLIENT_SECRET || "",
      }),
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || typeof token.access_token !== "string") return res.status(502).json({ error: "无法读取 Dropbox 授权，请重新连接。" });
    const response = await fetch("https://api.dropboxapi.com/2/files/list_folder" + (cursor ? "/continue" : ""), {
      method: "POST", headers: { Authorization: "Bearer " + token.access_token, "Content-Type": "application/json" },
      body: JSON.stringify(cursor ? { cursor } : { path: folder, limit: 100 }),
    });
    if (!response.ok) return res.status(response.status === 429 ? 429 : 502).json({ error: "暂时无法读取 Dropbox 文件夹，请重试。" });
    const page = await response.json();
    const files = (page.entries as DropboxEntry[]).filter(item => item[".tag"] === "folder" || item[".tag"] === "file")
      .map(item => ({ id: item.id, name: item.name, folder: item[".tag"] === "folder" }));
    return res.json({ files, nextCursor: page.has_more ? page.cursor : undefined });
  } catch {
    return res.status(502).json({ error: "Dropbox 文件服务暂时不可用。" });
  }
}
