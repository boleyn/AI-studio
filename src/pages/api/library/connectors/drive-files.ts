import type { NextApiRequest, NextApiResponse } from "next";
import { createDecipheriv } from "node:crypto";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.setHeader("Allow", "GET").status(405).end();
  const folder = req.query.folder || "root";
  if (typeof folder !== "string" || !/^[\w-]{1,256}$/.test(folder)) return res.status(400).end();
  const owner = String(auth.user._id);
  const db = await getMongoDb();
  const row = await db.collection<{_id: string; token: string}>("library_drive_connections").findOne({_id: owner});
  if (!row) return res.status(409).json({error:"请先连接 Google Drive"});
  try {
    const bytes = Buffer.from(row.token, "base64");
    const cipher = createDecipheriv("aes-256-gcm", Buffer.from(process.env.LIBRARY_CONNECTOR_KEY || "", "base64"), bytes.subarray(0,12));
    cipher.setAAD(Buffer.from(owner));
    cipher.setAuthTag(bytes.subarray(12,28));
    const refresh = Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {method:"POST", body:new URLSearchParams({
      client_id:process.env.GOOGLE_DRIVE_CLIENT_ID || "",client_secret:process.env.GOOGLE_DRIVE_CLIENT_SECRET || "",
      grant_type:"refresh_token",refresh_token:refresh,
    })});
    const data = await tokenResponse.json();
    if (!tokenResponse.ok || typeof data.access_token !== "string") return res.status(502).json({error:"Google Drive 授权不可用，请重新连接"});
    const params = new URLSearchParams({q:"trashed = false and '" + folder + "' in parents", pageSize:"100", orderBy:"folder,name_natural",
      supportsAllDrives:"true",includeItemsFromAllDrives:"true",fields:"nextPageToken,files(id,name,mimeType,webViewLink)"});
    if (typeof req.query.page === "string") params.set("pageToken",req.query.page);
    const response = await fetch("https://www.googleapis.com/drive/v3/files?" + params, {headers:{Authorization:"Bearer " + data.access_token}});
    if (!response.ok) return res.status(502).json({error:"无法读取 Google Drive 文件夹"});
    return res.json(await response.json());
  } catch { return res.status(502).json({error:"Google Drive 暂时不可用"}); }
}
