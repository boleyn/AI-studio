import type { NextApiRequest, NextApiResponse } from "next";
import { ObjectId } from "mongodb";
import { requireAuth } from "@server/auth/session";
import { findUserByUsername } from "@server/auth/userStore";
import { getMongoDb } from "@server/db/mongo";

export default async function handler(req:NextApiRequest,res:NextApiResponse) {
  const auth = await requireAuth(req,res);
  if (!auth) return;
  res.setHeader("Cache-Control","private, no-store");
  const id = req.query.id;
  if (typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id)) return res.status(404).end();
  const pages = (await getMongoDb()).collection<{owner:string;name:string;kind?:string|null;sharedBy?:string;body?:string;folderId?:string;members?:{userId:string;username:string}[]}>("library_pages");
  const userId = String(auth.user._id);
  const active = {deleted:{$ne:true},purging:{$ne:true}};
  const filter = {...active,_id:new ObjectId(id),kind:"资料空间"};
  const space = await pages.findOne({...filter,$or:[{owner:userId},{"members.userId":userId}]});
  if (!space) return res.status(404).json({error:"资料空间不可用"});
  const owner = space.owner === userId;
  if (req.method === "PATCH") {
    if (!owner) return res.status(403).end();
    const name = req.body?.username;
    if (typeof name !== "string" || !name.trim() || name.length > 100) return res.status(400).end();
    const user = await findUserByUsername(name.trim());
    if (!user || String(user._id) === userId) return res.status(400).json({error:"请选择有效的成员账号"});
    const member = {username:user.username,userId:String(user._id)};
    const updateFilter = {...filter,owner:userId};
    if (req.body.remove === true) await pages.updateOne(updateFilter,{$pull:{members:member}});
    else await pages.updateOne(updateFilter,{$addToSet:{members:member},$set:{sharedBy:auth.user.displayName || auth.user.username}});
    const updated = await pages.findOne(updateFilter,{projection:{members:1}});
    return res.json({members:updated?.members || []});
  }
  if (req.method !== "GET") return res.setHeader("Allow","GET, PATCH").status(405).end();
  if (req.query.contents !== "1") {
    if (!owner) return res.status(403).end();
    return res.json({id,filename:space.name,owner:auth.user.username,members:space.members || []});
  }
  if (owner && !req.query.page) return res.json({owner:true,name:space.name});
  // Resolve membership from the live folder tree so moved and trashed pages leave the share.
  const entries = await pages.find({owner:space.owner,...active,kind:{$in:["文件夹","页面",null]}},
    {projection:{name:1,kind:1,folderId:1}}).toArray();
  const folders = new Set([id]);
  const children = new Map<string,typeof entries>();
  for (const entry of entries) {
    if (!entry.folderId) continue;
    const siblings = children.get(entry.folderId);
    if (siblings) siblings.push(entry); else children.set(entry.folderId,[entry]);
  }
  const included = [];
  for (const parent of folders) for (const entry of children.get(parent) || []) {
    if (entry.kind === "文件夹") folders.add(String(entry._id));
    else included.push({id:String(entry._id),name:entry.name});
  }
  if (req.query.page) {
    const page = included.find(item=>item.id === req.query.page);
    if (!page) return res.status(404).end();
    const content = await pages.findOne({...active,owner:space.owner,_id:new ObjectId(page.id),folderId:{$in:[...folders]}},{projection:{name:1,body:1}});
    return content ? res.json(content) : res.status(404).end();
  }
  return res.json({name:space.name,pages:included});
}
