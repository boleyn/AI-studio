import type { NextApiRequest, NextApiResponse } from "next";
import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";
import { getMongoDb } from "@server/db/mongo";
import { requireAuth } from "@server/auth/session";
import { sendConnectorDownload } from "@server/library/sendConnectorDownload";

type Hit = { resource?: { id?: string; name?: string; file?: object; parentReference?: { driveId?: string } } };
const graph = "https://graph.microsoft.com/v1.0";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req,res);
  if (!auth) return;
  res.setHeader("Cache-Control","private, no-store");
  if (req.method !== "GET") return res.setHeader("Allow","GET").status(405).end();
  const { query = "", cursor = "0", file } = req.query;
  if (typeof query !== "string" || query.length > 500 || typeof cursor !== "string" || !/^\d{1,7}$/.test(cursor)) return res.status(400).end();
  const item = file === undefined ? null : typeof file === "string" && /^([\w!-]+):([\w!-]+)$/.exec(file);
  if (file !== undefined && !item) return res.status(400).end();
  const owner = String(auth.user._id);
  const connections = (await getMongoDb()).collection<{_id:string;token:string}>("library_sharepoint_connections");
  const connection = await connections.findOne({_id:owner});
  if (!connection) return res.status(409).json({error:"请先连接 SharePoint。"});
  if (!item && !query.trim()) return res.json({files:[]});
  try {
    const key = Buffer.from(process.env.LIBRARY_CONNECTOR_KEY || "", "base64");
    const aad = Buffer.from("sharepoint:" + owner);
    const bytes = Buffer.from(connection.token,"base64");
    const decrypt = createDecipheriv("aes-256-gcm",key,bytes.subarray(0,12));
    decrypt.setAAD(aad);
    decrypt.setAuthTag(bytes.subarray(12,28));
    const refresh = Buffer.concat([decrypt.update(bytes.subarray(28)),decrypt.final()]).toString();
    const renewal = await fetch("https://login.microsoftonline.com/organizations/oauth2/v2.0/token",{method:"POST",body:new URLSearchParams({
      client_id:process.env.SHAREPOINT_CLIENT_ID || "",client_secret:process.env.SHAREPOINT_CLIENT_SECRET || "",grant_type:"refresh_token",refresh_token:refresh,
    })});
    const tokens = await renewal.json();
    if (!renewal.ok || typeof tokens.access_token !== "string") return res.status(502).json({error:"SharePoint 授权已不可用，请重新连接。"});
    if (typeof tokens.refresh_token === "string") {
      const iv = randomBytes(12);
      const encrypt = createCipheriv("aes-256-gcm",key,iv);
      encrypt.setAAD(aad);
      const ciphertext = Buffer.concat([encrypt.update(tokens.refresh_token,"utf8"),encrypt.final()]);
      await connections.updateOne({_id:owner,token:connection.token},{$set:{token:Buffer.concat([iv,encrypt.getAuthTag(),ciphertext]).toString("base64")}});
    }
    const headers = {Authorization:"Bearer " + tokens.access_token};
    if (item) {
      const path = graph + "/drives/" + item[1] + "/items/" + item[2];
      const info = await fetch(path + "?$select=name,size,file",{headers});
      if (!info.ok) return res.status(info.status === 404 ? 404 : 502).json({error:"无法读取 SharePoint 文件。"});
      const data = await info.json();
      if (!data.file || typeof data.name !== "string") return res.status(422).json({error:"请选择文件。"});
      if (data.size > 10*1024*1024) return res.status(413).json({error:"附件超过 10 MB。"});
      const download = await fetch(path + "/content",{headers});
      if (!download.ok || !download.body) return res.status(502).json({error:"SharePoint 文件下载失败。"});
      return await sendConnectorDownload(download.body,data.name,res);
    }
    const from = Number(cursor);
    const result = await fetch(graph + "/search/query",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({
      requests:[{entityTypes:["driveItem"],query:{queryString:"(" + query.trim() + ") AND IsDocument:true"},from,size:50}],
    })});
    if (!result.ok) return res.status(result.status === 429 ? 429 : 502).json({error:"SharePoint 搜索暂时不可用，请重试。"});
    const page = (await result.json()).value[0].hitsContainers[0];
    const files = (page.hits as Hit[]).flatMap(({resource:r}) => r?.parentReference?.driveId && r.id && r.name && !('folder' in r)
      ? [{id:r.parentReference.driveId + ":" + r.id,name:r.name,folder:false}] : []);
    return res.json({files,nextCursor:page.moreResultsAvailable ? String(from + 50) : undefined});
  } catch {
    return res.status(502).json({error:"SharePoint 文件服务暂时不可用。"});
  }
}
