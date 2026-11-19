import type { NextApiRequest, NextApiResponse } from "next";
import { markdownFilename } from "@/types/library";
import { ObjectId } from "mongodb";
import { requireAuth } from "@server/auth/session";
import { findSpaceInviteRecipient, findUserByUsername } from "@server/auth/userStore";
import { getMongoDb } from "@server/db/mongo";

export default async function handler(req:NextApiRequest,res:NextApiResponse) {
  const auth = await requireAuth(req,res);
  if (!auth) return;
  res.setHeader("Cache-Control","private, no-store");
  const id = req.query.id;
  if (typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id)) return res.status(404).end();
  const db = await getMongoDb();
  const pages = db.collection<{owner:string;name:string;kind?:string|null;sharedBy?:string;body?:string;folderId?:string;members?:{userId:string;username:string}[]}>("library_pages");
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
    const user = req.body.remove === true ? await findUserByUsername(name.trim()) : await findSpaceInviteRecipient(name.trim());
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
  const pageId = req.query.page;
  if (pageId !== undefined && (typeof pageId !== "string" || !/^[a-f0-9]{24}$/.test(pageId))) {
    return res.status(404).end();
  }
  const accessible = {owner:space.owner,...active,kind:{$in:["文件夹","页面",null]}};
  if (pageId) {
    // Opening a page only requires checking its own chain of parents.
    const page = await pages.findOne({...accessible,_id:new ObjectId(pageId),kind:{$in:["页面",null]}},
      {projection:{name:1,body:1,folderId:1}});
    if (!page) return res.status(404).end();
    let parent = page.folderId;
    const seen = new Set([pageId]);
    while (parent !== id) {
      if (!parent || !/^[a-f0-9]{24}$/.test(parent) || seen.has(parent)) return res.status(404).end();
      seen.add(parent);
      const ancestor = await pages.findOne({...accessible,_id:new ObjectId(parent)},{projection:{folderId:1}});
      parent = ancestor?.folderId;
    }
    if (req.query.download === "1") {
      const filename = encodeURIComponent(markdownFilename(page.name)).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16));
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + filename);
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send("# " + page.name + "\n\n" + (page.body || ""));
    }
    return res.json({owner,name:page.name,body:page.body});
  }
  const included: {id:string;name:string;path:string}[] = [];
  const paths = new Map([[id,""]]);
  const visited = new Set([id]);
  let parents = [id];
  while (parents.length) {
    const children = await pages.find({...accessible,folderId:{$in:parents}},
      {projection:{name:1,kind:1,folderId:1}}).toArray();
    parents = [];
    for (const child of children) {
      const childId = String(child._id);
      if (visited.has(childId)) continue;
      visited.add(childId);
      const path = [paths.get(child.folderId || ""),child.name].filter(Boolean).join(" / ");
      paths.set(childId,path);
      parents.push(childId);
      if (child.kind !== "文件夹") included.push({id:childId,name:child.name,path});
    }
  }
  const key = (pageId:string) => userId + "/space-" + id + "-" + pageId;
  const activity = await db.collection<{_id:string;owner:string;openedAt?:string}>("library_file_settings")
    .find({owner:userId,_id:{$in:included.map(page=>key(page.id))}},{projection:{openedAt:1}}).toArray();
  const opened = new Map(activity.map(entry => [entry._id,entry.openedAt]));
  return res.json({name:space.name,pages:included.map(page=>({...page,openedAt:opened.get(key(page.id))}))});
}
