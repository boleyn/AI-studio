import type { NextApiRequest, NextApiResponse } from "next";
import { createDecipheriv } from "node:crypto";
import { requireAuth } from "@server/auth/session";
import { sendDriveAttachment } from "@server/library/driveAttachment";
import { getMongoDb } from "@server/db/mongo";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET" && req.method !== "PATCH") return res.setHeader("Allow", "GET, PATCH").status(405).end();
  const folder = req.query.folder || "root";
  if (typeof folder !== "string" || !/^[\w-]{1,256}$/.test(folder)) return res.status(400).end();
  const owner = String(auth.user._id);
  const db = await getMongoDb();
  const row = await db.collection<{_id: string; token: string;canRename?:boolean}>("library_drive_connections").findOne({_id: owner});
  if (!row) return res.status(409).json({error:"请先连接 Google Drive"});
  if (req.method === "PATCH") {
    if (typeof req.query.file !== "string" || !/^[\w-]{1,256}$/.test(req.query.file) || typeof req.body?.name !== "string" || !req.body.name.trim() || req.body.name.length > 255) return res.status(400).end();
    if (!row.canRename) return res.status(403).json({authorize:true,error:"重命名需要授权修改 Drive 文件元数据"});
  }
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
    if (req.query.file !== undefined) {
      if (typeof req.query.file !== "string" || !/^[\w-]{1,256}$/.test(req.query.file)) return res.status(400).end();
      if (req.method === "PATCH") {
        const response = await fetch("https://www.googleapis.com/drive/v3/files/" + req.query.file + "?supportsAllDrives=true&fields=id,name", {
          method:"PATCH",headers:{Authorization:"Bearer "+data.access_token,"Content-Type":"application/json"},body:JSON.stringify({name:req.body.name.trim()}),
        });
        if (!response.ok) return res.status(response.status).json({error:"无法重命名，请检查文件权限后重试"});
        return res.json(await response.json());
      }
      return await sendDriveAttachment(req.query.file,data.access_token,res,req.query.download === "1");
    }
    const scope = req.query.scope || "mine";
    const search = typeof req.query.query === "string" ? req.query.query.trim() : "";
    const terms = ["trashed = false"];
    if (folder !== "root" || (scope === "mine" && !search)) terms.push("'" + folder + "' in parents");
    else if (scope === "mine") terms.push("'me' in owners");
    else if (scope === "shared") terms.push("sharedWithMe");
    if (search) {
      const escaped = search.replaceAll("\\","\\\\").replaceAll("'","\\'");
      terms.push("name contains '" + escaped + "'");
    }
    const recent = folder === "root" && scope === "recent";
    const sortKey = req.query.sort === "modified" ? "modifiedTime" : req.query.sort === "size" ? "quotaBytesUsed" : "name_natural";
    const order = "folder," + sortKey + (req.query.direction === "desc" ? " desc" : "");
    const params = new URLSearchParams({q:terms.join(" and "), pageSize:"100", orderBy:recent ? "recency desc" : order,
      supportsAllDrives:"true",includeItemsFromAllDrives:"true",fields:"nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,viewedByMeTime,size)"});
    if (typeof req.query.page === "string") params.set("pageToken",req.query.page);
    const response = await fetch("https://www.googleapis.com/drive/v3/files?" + params, {headers:{Authorization:"Bearer " + data.access_token}});
    if (!response.ok) return res.status(502).json({error:"无法读取 Google Drive 文件夹"});
    return res.json(await response.json());
  } catch { if (res.destroyed || res.headersSent) return; return res.status(502).json({error:"Google Drive 暂时不可用"}); }
}
