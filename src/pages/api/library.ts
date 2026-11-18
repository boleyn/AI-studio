import { createHash } from "node:crypto";
import { listReceivedArtifactShares } from "@server/shares/artifactShareStorage";
import { purgeLibraryItem } from "@server/library/trash";
import { ObjectId } from "mongodb";
import { z } from "zod";
import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";
import { getProjectAccessState, listProjectOverviewItems } from "@server/projects/projectStorage";
import type { LibraryFile } from "@/types/library";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "PATCH", "POST", "DELETE"].includes(req.method || "")) return res.setHeader("Allow", "GET, PATCH, POST, DELETE").status(405).end();
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");
  const db = await getMongoDb();
  const owner = String(auth.user._id);
  const settings = db.collection<{ _id: string; owner: string; purged?:boolean; openedAt?: string; deletedAt?:string | null; folderId?: string | null; name?: string; deleted?: boolean; favorite?: boolean }>("library_file_settings");
  if (req.method === "DELETE") {
    const id = req.query.id;
    if (typeof id !== "string" || !/^(?:[a-f0-9]{24}|[a-f0-9]{64})$/.test(id)) return res.status(400).end();
    const status = await purgeLibraryItem(db, owner, id);
    return status === 409 ? res.status(status).json({error:"请先移出或删除文件夹中的条目"}) : res.status(status).end();
  }
  if (req.method === "POST") {
    const operation = z.object({openedId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/)}).safeParse(req.body);
    if (!operation.success) return res.status(400).end();
    await settings.updateOne({_id: owner + "/" + operation.data.openedId, owner},
      {$max: {openedAt: new Date().toISOString()}}, {upsert: true});
    return res.status(204).end();
  }
  if (req.method === "PATCH") {
    const result = z.object({
      id: z.string().regex(/^[a-f0-9]{64}$/),
      changes: z.object({ folderId:z.string().regex(/^[a-f0-9]{24}$/).nullable().optional(), name: z.string().trim().min(1).max(255).optional(), favorite: z.boolean().optional(), deleted: z.boolean().optional() }).strict(),
    }).safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: "无效的文件操作" });
    const { id, changes } = result.data;
    if (changes.folderId && !await db.collection("library_pages").findOne({owner,_id:new ObjectId(changes.folderId),kind:{$in:["文件夹","资料空间"]},deleted:{$ne:true}})) return res.status(400).end();
    await settings.updateOne({ _id: owner + "/" + id, owner }, { $set: {...changes,...(changes.deleted === undefined ? {} : {deletedAt:changes.deleted ? new Date().toISOString() : null})} }, { upsert: true });
    return res.status(204).end();
  }
  const projects = await listProjectOverviewItems(owner);
  const names = new Map(projects.map(project => [project.token, project.name]));
  const scope = { token: { $in: [...names.keys()] } };
  const conversations = await db.collection("conversations").find(scope)
    .project({ token: 1, chatId: 1, customTitle: 1, title: 1, deleteTime: 1 }).toArray();
  const chats = new Map(conversations.map(chat => [JSON.stringify([chat.token, chat.chatId]), chat]));
  const rows = new Map<string, LibraryFile>();
  const messages = db.collection("conversation_items").find({ ...scope, $or: [
    { "additional_kwargs.workspaceArtifactPaths.0": { $exists: true } },
    { "artifact.files.0": { $exists: true } },
    { "content.type": "attachment" }, { "message.content.type": "attachment" },
  ] }).project({ token: 1, chatId: 1, time: 1, "additional_kwargs.workspaceArtifactPaths": 1,
    "additional_kwargs.workspaceArtifactVersion": 1, "artifact.files.storagePath": 1, "artifact.files.name": 1, "artifact.files.size": 1,
    "content.type": 1, "content.storage_path": 1, "content.source_storage_path": 1, "content.name": 1,
    "message.content.type": 1, "message.content.storage_path": 1, "message.content.source_storage_path": 1, "message.content.name": 1 });
  for await (const msg of messages) {
    const chat = chats.get(JSON.stringify([msg.token, msg.chatId]));
    if (!chat) continue;
    const add = (kind: LibraryFile["kind"], path: unknown, label?: unknown, version?: string, size?: unknown) => {
      if (typeof path !== "string" || !path) return;
      const key = JSON.stringify([msg.token, msg.chatId, kind, path, version]);
      const id = createHash("sha256").update(key).digest("hex");
      const row: LibraryFile = { id, kind, path, version, size:typeof size === "number" ? size : rows.get(key)?.size, token: msg.token, project: names.get(msg.token) || "",
        chatId: msg.chatId, conversation: chat.deleteTime ? "" : chat.customTitle || chat.title || "未命名会话",
        name: typeof label === "string" && label ? label : path.split("/").pop() || path,
        time: new Date(msg.time || 0).toISOString() };
      if ((rows.get(key)?.time || "") <= row.time) rows.set(key, row);
    };
    const meta = msg.additional_kwargs;
    if (Array.isArray(meta?.workspaceArtifactPaths)) {
      for (const path of meta.workspaceArtifactPaths) add("生成", path, undefined, meta.workspaceArtifactVersion);
    }
    const attachment = (path: unknown, name: unknown, size?:unknown) => {
      if (typeof path === "string" && /^\/?chat_uploads\//.test(path)) add("上传", path, name, undefined, size);
    };
    if (Array.isArray(msg.artifact?.files)) {
      for (const file of msg.artifact.files) attachment(file?.storagePath, file?.name, file?.size);
    }
    const blocks = msg.message?.content ?? msg.content;
    if (Array.isArray(blocks)) {
      for (const block of blocks) if (block?.type === "attachment") attachment(block.source_storage_path || block.storage_path, block.name);
    }
  }
  const pages = db.collection("library_pages").find({owner},{projection:{name:1,time:1,deletedAt:1,size:1,favorite:1,deleted:1,kind:1,folderId:1,originalName:1,reference:1}});
  for await (const page of pages) {
    const id = page._id.toHexString();
    rows.set(id,{id,kind:page.kind || "页面",folderId:page.folderId,name:page.name,time:page.time,directUpload:page.kind === "上传",path:page.originalName || id,token:"",project:"",chatId:"",conversation:"",
      reference:page.reference,size:page.size,deletedAt:page.deletedAt,favorite:page.favorite,deleted:page.deleted});
  }
  const received = await listReceivedArtifactShares(owner);
  const sharedPageIds = received.flatMap(share => share.libraryItemId ? [new ObjectId(share.libraryItemId)] : []);
  const sharedPages = new Map((sharedPageIds.length ? await db.collection("library_pages").find(
    {_id:{$in:sharedPageIds},deleted:{$ne:true},purging:{$ne:true}},
    {projection:{owner:1,name:1}}
  ).toArray() : []).map(page => [page._id.toHexString(), page]));
  for (const share of received) {
    const page = share.libraryItemId ? sharedPages.get(share.libraryItemId) : undefined;
    if (share.libraryItemId ? page?.owner !== share.ownerId : await getProjectAccessState(share.projectToken,share.ownerId) !== "ok") continue;
    const id = share._id;
    const filename = share.livePage && page ? page.name + ".md" : share.filename;
    rows.set(id,{id,shareId:id,sharedPage:share.livePage,editablePageId:share.livePage && share.members[0]?.canEdit ? share.libraryItemId : undefined,kind:"上传",name:share.livePage && page ? page.name : filename,path:filename,time:share.members?.[0]?.invitedAt || "",token:"",chatId:"",project:share.ownerName,conversation:""});
  }
  const preferences = new Map((await settings.find({ owner }).toArray()).map(entry => [entry._id, entry]));
  res.json([...rows.values()].filter(file => !preferences.get(owner + "/" + file.id)?.purged).map(file => {
    const entry = preferences.get(owner + "/" + file.id);
    return entry ? { ...file, openedAt:entry.openedAt, deletedAt:entry.deletedAt ?? file.deletedAt, folderId:entry.folderId === undefined ? file.folderId : entry.folderId, name: entry.name || file.name, favorite: entry.favorite ?? file.favorite, deleted: entry.deleted ?? file.deleted } : file;
  }).sort((a, b) => b.time.localeCompare(a.time)));
}
