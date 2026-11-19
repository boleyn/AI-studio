import { listLibraryContents } from "@server/library/contents";
import { createHash } from "node:crypto";
import { purgeLibraryItem } from "@server/library/trash";
import { ObjectId } from "mongodb";
import { z } from "zod";
import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";
import { readProjectArtifactVersion, readProjectFile, updateBinaryFile } from "@server/projects/projectStorage";
import type { LibraryFile } from "@/types/library";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "PATCH", "POST", "DELETE"].includes(req.method || "")) return res.setHeader("Allow", "GET, PATCH, POST, DELETE").status(405).end();
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");
  const db = await getMongoDb();
  const owner = String(auth.user._id);
  const settings = db.collection<{ _id: string; owner: string; trashRoot?: string; siteSlug?:string; purged?:boolean; openedAt?: string; deletedAt?:string | null; folderId?: string | null; name?: string; deleted?: boolean; favorite?: boolean; pinned?:boolean }>("library_file_settings");
  if (req.method === "DELETE") {
    const id = req.query.id;
    if (typeof id !== "string" || !/^(?:[a-f0-9]{24}|[a-f0-9]{64})$/.test(id)) return res.status(400).end();
    const status = await purgeLibraryItem(db, owner, id);
    return status === 409 ? res.status(status).json({error:"请先恢复此条目并移出其中的资料，或先永久删除已在回收站中的子项。"}) : res.status(status).end();
  }
  const restoring = req.method === "POST" && req.query.action === "restore-version";
  if (req.method === "POST" && !restoring) {
    const itemId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
    const operation = z.union([z.object({openedId:itemId}),z.object({openedIds:z.array(itemId).min(1).max(100)})]).safeParse(req.body);
    if (!operation.success) return res.status(400).end();
    const ids = "openedId" in operation.data ? [operation.data.openedId] : operation.data.openedIds;
    const openedAt = new Date().toISOString();
    await settings.bulkWrite([...new Set(ids)].map(id => ({updateOne:{
      filter:{_id:owner + "/" + id,owner},update:{$max:{openedAt}},upsert:true,
    }})),{ordered:false});
    return res.status(204).end();
  }
  if (req.method === "PATCH") {
    const result = z.object({
      id: z.string().regex(/^[a-f0-9]{64}$/),
      changes: z.object({ folderId:z.string().regex(/^[a-f0-9]{24}$/).nullable().optional(), name: z.string().trim().min(1).max(255).optional(), favorite: z.boolean().optional(), pinned:z.boolean().optional(), deleted: z.boolean().optional() }).strict(),
    }).safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: "无效的文件操作" });
    const { id, changes } = result.data;
    if (changes.folderId && !await db.collection("library_pages").findOne({owner,_id:new ObjectId(changes.folderId),kind:{$in:["文件夹","资料空间"]},deleted:{$ne:true}})) return res.status(400).end();
    await settings.updateOne({ _id: owner + "/" + id, owner }, {
      ...(changes.deleted === false ? {$unset:{trashRoot:"" as const}} : {}),
      $set: {...changes,...(changes.deleted === undefined ? {} : {deletedAt:changes.deleted ? new Date().toISOString() : null})} }, { upsert: true });
    return res.status(204).end();
  }
  const {listed,names,preferences,chats,restores} = await listLibraryContents(owner,auth.user.displayName || auth.user.username);
  if (!restoring) return res.json(listed);
  const request = z.object({id:z.string().regex(/^[a-f0-9]{64}$/),head:z.string().regex(/^[a-f0-9]{64}$/)}).safeParse(req.body);
  if (!request.success) return res.status(400).end();
  const source = listed.find(file => file.id === request.data.id && file.kind === "生成" && !file.deleted);
  if (!source?.version || !names.has(source.token)) return res.status(404).end();
  const head = listed.find(file => file.kind === "生成" && !file.deleted && file.token === source.token && file.chatId === source.chatId && file.path === source.path);
  const id = createHash("sha256").update(JSON.stringify(["restore",request.data.head])).digest("hex");
  const priorRestore = preferences.get(owner + "/" + id);
  if (priorRestore?.purged || priorRestore?.deleted) return res.status(409).end();
  if (head?.id === id) return head.version === source.version ? res.json(head) : res.status(409).end();
  if (!head?.version || head.id !== request.data.head || head.id === source.id) return res.status(409).end();
  const [live, current, previous] = await Promise.all([
    readProjectFile(source.token,source.path),
    readProjectArtifactVersion(head.token,head.version,head.path),
    readProjectArtifactVersion(source.token,source.version,source.path),
  ]);
  if (!live.buffer.equals(current.buffer) && !live.buffer.equals(previous.buffer)) return res.status(409).end();
  const headTime = Date.parse(head.time);
  const restoredAt = Number.isFinite(headTime) ? Math.max(Date.now(), headTime + 1) : Date.now();
  const restored: LibraryFile = {...head,id,version:source.version,size:previous.buffer.length,time:new Date(restoredAt).toISOString()};
  const record = await restores.findOneAndUpdate({_id:id,owner},{$setOnInsert:{...restored,owner,pending:true}},{upsert:true,returnDocument:"after"});
  if (!record || record.version !== source.version) return res.status(409).end();
  if (record.pending) {
    await updateBinaryFile(source.token,source.path,previous.buffer,live.contentType);
    await restores.updateOne({_id:id,owner},{$unset:{pending:""}});
  }
  return res.json({...restored,time:record.time});
}
