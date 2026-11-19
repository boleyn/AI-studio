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
  const db = await getMongoDb();
  const domains = db.collection<{_id:string;shareId:string;host:string;challenge:string;verified:boolean}>("site_domains");
  const publications = await db.collection("share_links").distinct<string>("shareId", {
    projectToken:share.projectToken, ownerUserId:share.ownerUserId, mode:"preview"
  });
  const filter = {shareId:{$in:publications}};
  if (req.method === "GET") return res.json(await domains.aggregate([
    {$match:filter}, {$sort:{verified:-1,_id:1}},
    {$group:{_id:"$host",challenge:{$first:"$challenge"},verified:{$first:"$verified"}}},
    {$project:{_id:0,host:"$_id",challenge:1,verified:1}}, {$sort:{host:1}}
  ]).toArray());
  const input = req.body?.host;
  const rawHost = typeof input === "string" ? input.trim() : "";
  if (!rawHost || /[\s/:?#@%\\]/u.test(rawHost)) {
    return res.status(400).json({error:"只需输入域名，例如 www.example.com，请去掉协议、端口和路径。"});
  }
  const host = domainToASCII(rawHost).toLowerCase().replace(/\.$/, "");
  const labels = host.split(".");
  const validLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (host.length > 253 || labels.length < 2 || !labels.every(label=>validLabel.test(label)) ||
      !/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(labels[labels.length-1])) {
    return res.status(400).json({error:"请输入完整域名，例如 www.example.com。"});
  }
  const matching = {...filter,host};
  if (req.method === "DELETE") {
    await domains.deleteMany(matching);
    return res.status(204).end();
  }
  if (req.method === "POST") {
    if (await domains.findOne(matching,{projection:{_id:1}})) return res.status(204).end();
    const key = {_id:JSON.stringify([share.ownerUserId,share.projectToken,host])};
    await domains.updateOne(key,{$setOnInsert:{shareId:share.shareId,host,challenge:randomBytes(24).toString("hex"),verified:false}},{upsert:true});
    return res.status(204).end();
  }
  if (req.method !== "PATCH") return res.status(405).end();
  const record = await domains.findOne(matching,{sort:{verified:-1,_id:1}});
  if (!record) return res.status(404).end();
  let records: string[][];
  try {
    records = await resolveTxt("_bore-site."+host);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENODATA" || code === "ENOTFOUND") {
      return res.status(422).json({error:"尚未查到 TXT 记录。如果刚刚添加，请等待 DNS 更新后再验证。"});
    }
    return res.status(503).json({error:"DNS 查询暂时失败，请稍后重新验证。"});
  }
  if (!records.some(parts=>parts.join("")===record.challenge)) return res.status(422).json({error:"已查到 TXT 记录，但记录值不匹配。请核对验证值后重试。"});
  await domains.createIndex({host:1},{unique:true,partialFilterExpression:{verified:true}});
  try {
    const update = await domains.updateOne({_id:record._id,challenge:record.challenge},{$set:{verified:true}});
    if (!update.matchedCount) return res.status(409).end();
  } catch (error) {
    if ((error as {code?:number}).code===11000) return res.status(409).json({error:"此域名已绑定其他站点。"});
    throw error;
  }
  return res.status(204).end();
}
