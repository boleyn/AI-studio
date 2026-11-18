import { ObjectId } from "mongodb";
import { z } from "zod";
import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";
import type { LibraryFile } from "@/types/library";

import { getArtifactShare } from "@server/shares/artifactShareStorage";

const fields = z.object({ name: z.string().trim().min(1).max(255), body: z.string().max(500000) });
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const owner = String(auth.user._id);
  const db = await getMongoDb();
  const pages = db.collection("library_pages");
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method === "POST") {
    let input = req.body;
    if (input?.duplicateId !== undefined) {
      const id = z.string().regex(/^[a-f0-9]{24}$/).safeParse(input.duplicateId);
      if (!id.success) return res.status(400).end();
      const source = await pages.findOne({_id:new ObjectId(id.data),owner,kind:{$in:["页面",null]},deleted:{$ne:true},purging:{$ne:true}},
        {projection:{name:1,body:1,folderId:1}});
      if (!source) return res.status(404).end();
      input = {name:source.name.slice(0,252)+" 副本",body:source.body,folderId:source.folderId,kind:"页面"};
    }
    const parsed = fields.extend({kind:z.enum(["页面","文件夹","资料空间"]).default("页面"),folderId:z.string().regex(/^[a-f0-9]{24}$/).nullable().optional()}).safeParse(input);
    if (!parsed.success) return res.status(400).end();
    const time = new Date().toISOString();
    if (parsed.data.folderId && !await pages.findOne({owner,_id:new ObjectId(parsed.data.folderId),kind:{$in:["文件夹","资料空间"]},deleted:{$ne:true}})) return res.status(400).end();
    const { insertedId } = await pages.insertOne({ owner, ...parsed.data, time });
    const id = insertedId.toHexString();
    const item: LibraryFile = { id, kind:parsed.data.kind, folderId:parsed.data.folderId, token:"", project:"", chatId:"", conversation:"", path:id, name:parsed.data.name, time };
    return res.status(201).json(item);
  }
  if (typeof req.query.id !== "string" || !/^[0-9a-f]{24}$/.test(req.query.id)) return res.status(400).end();
  let pageOwner = owner;
  const shareId = req.query.share;
  if (shareId !== undefined) {
    const share = typeof shareId === "string" ? await getArtifactShare(shareId) : null;
    if (!share?.livePage || share.libraryItemId !== req.query.id ||
      (share.ownerId !== owner && !share.members.some(m => m.userId === owner && m.canEdit))) return res.status(404).end();
    pageOwner = share.ownerId;
    if (req.method === "PATCH" && !fields.extend({expectedRevision:z.number().int().nonnegative()}).strict().safeParse(req.body).success) return res.status(400).end();
  }
  const filter = { owner:pageOwner, ...(shareId !== undefined ? {deleted:{$ne:true}} : {}), purging:{$ne:true}, _id:new ObjectId(req.query.id) };
  if (req.method === "GET") {
    const page = await pages.findOne(filter,{projection:{body:1,name:1,revision:1}});
    return page ? res.json(page) : res.status(404).end();
  }
  if (req.method === "PATCH") {
    const patch = fields.partial().extend({expectedRevision:z.number().int().nonnegative().optional(),folderId:z.string().regex(/^[a-f0-9]{24}$/).nullable().optional(),favorite:z.boolean().optional(),pinned:z.boolean().optional(),deleted:z.boolean().optional()}).strict().safeParse(req.body);
    if (!patch.success) return res.status(400).end();
    const time = new Date().toISOString();
    if (patch.data.folderId) {
      if (!await pages.findOne({ ...filter,kind:{$nin:["文件夹","资料空间"]} })) return res.status(400).end();
      if (!await pages.findOne({owner,_id:new ObjectId(patch.data.folderId),kind:{$in:["文件夹","资料空间"]},deleted:{$ne:true}})) return res.status(400).end();
    }
    const {expectedRevision,...changes} = patch.data;
    const versionFilter = expectedRevision === undefined ? {} :
      expectedRevision === 0 ? {$or:[{revision:0},{revision:{$exists:false}}]} : {revision:expectedRevision};
    const editsContent = changes.name !== undefined || changes.body !== undefined;
    const saved = await pages.findOneAndUpdate({...filter,...versionFilter},{
      $set:{...changes,time,...(changes.deleted === undefined ? {} : {deletedAt:changes.deleted ? time : null})},
      ...(editsContent ? {$inc:{revision:1}} : {}),
    },{returnDocument:"after",projection:{revision:1}});
    if (saved) return res.json({time,revision:saved.revision || 0});
    if (expectedRevision !== undefined) {
      const latest = await pages.findOne(filter,{projection:{name:1,body:1,revision:1}});
      if (latest) return res.status(409).json(latest);
    }
    return res.status(404).end();
  }
  return res.setHeader("Allow","GET, POST, PATCH").status(405).end();
}
