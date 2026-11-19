import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { domainToASCII } from "node:url";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";
import { getShareLink } from "@server/shares/shareStorage";

export default async function handler(req:NextApiRequest,res:NextApiResponse) {
  const auth = await requireAuth(req,res);
  if (!auth) return;
  res.setHeader("Cache-Control","private, no-store");
  const share = typeof req.query.shareId === "string" && await getShareLink(req.query.shareId);
  if (!share || share.mode !== "preview" || share.ownerUserId !== String(auth.user._id)) return res.status(404).end();
  const domains = (await getMongoDb()).collection<{_id:string;shareId:string;host:string;challenge:string;verified:boolean}>("site_domains");
  const filter = {shareId:share.shareId};
  if (req.method === "GET") return res.json(await domains.find(filter,{projection:{_id:0,host:1,challenge:1,verified:1}}).toArray());
  const input = req.body?.host;
  const host = typeof input === "string" ? domainToASCII(input.trim().toLowerCase()) : "";
  if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return res.status(400).json({error:"请输入完整域名，例如 www.example.com。"});
  const key = {_id:share.shareId+"/"+host};
  if (req.method === "DELETE") {
    await domains.deleteOne(key);
    return res.status(204).end();
  }
  if (req.method === "POST") {
    await domains.updateOne(key,{$setOnInsert:{...filter,host,challenge:randomBytes(24).toString("hex"),verified:false}},{upsert:true});
    return res.status(204).end();
  }
  if (req.method !== "PATCH") return res.status(405).end();
  const record = await domains.findOne(key);
  if (!record) return res.status(404).end();
  const records = await resolveTxt("_bore-site."+host).catch(()=>[]);
  if (!records.some(parts=>parts.join("")===record.challenge)) return res.status(422).json({error:"尚未找到匹配的 TXT 记录，请检查 DNS 配置后重试。"});
  await domains.createIndex({host:1},{unique:true,partialFilterExpression:{verified:true}});
  try {
    const update = await domains.updateOne({...key,challenge:record.challenge},{$set:{verified:true}});
    if (!update.matchedCount) return res.status(409).end();
  } catch (error) {
    if ((error as {code?:number}).code===11000) return res.status(409).json({error:"此域名已绑定其他站点。"});
    throw error;
  }
  return res.status(204).end();
}
