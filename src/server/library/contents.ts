import { sharedPreviewFilename, markdownFilename } from "@/types/library";
import { createHash } from "node:crypto";
import { listReceivedArtifactShares } from "@server/shares/artifactShareStorage";
import { listLibrarySites, siteLibraryId } from "@server/library/sites";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@server/db/mongo";
import { canAccessArtifactSource } from "@server/chat/tokenAccess";
import type { LibraryFile } from "@/types/library";
import { listProjectOverviewItems } from "@server/projects/projectStorage";

export async function listLibraryContents(owner:string, creatorName?:string) {
  const db = await getMongoDb();
  const settings = db.collection<{ _id: string; owner: string; siteSlug?:string; purged?:boolean; openedAt?: string; deletedAt?:string | null; folderId?: string | null; name?: string; deleted?: boolean; favorite?: boolean; pinned?:boolean }>("library_file_settings");
  const projects = await listProjectOverviewItems(owner);
  const names = new Map(projects.map(project => [project.token, project.name]));
  const skills = await db.collection("skills").find({userId:owner}, {projection:{token:1,name:1}}).toArray();
  const chatNames = new Map(names);
  for (const skill of skills) if (!chatNames.has(skill.token)) chatNames.set(skill.token, skill.name);
  const scope = { token: { $in: [...chatNames.keys()] } };
  const conversations = await db.collection("conversations").find(scope)
    .project({ token: 1, chatId: 1, customTitle: 1, title: 1, deleteTime: 1 }).toArray();
  const chats = new Map(conversations.map(chat => [JSON.stringify([chat.token, chat.chatId]), chat]));
  const rows = new Map<string, LibraryFile>();
  const messages = db.collection("conversation_items").find({ ...scope, $or: [
    { "additional_kwargs.workspaceArtifactPaths.0": { $exists: true } },
    { "artifact.files.0": { $exists: true } },
    { "content.type": "attachment" }, { "message.content.type": "attachment" },
  ] }).project({ token: 1, chatId: 1, time: 1, "additional_kwargs.workspaceArtifactPaths": 1,
    "additional_kwargs.workspaceArtifactVersion": 1, "additional_kwargs.workspaceArtifactSizes": 1, "artifact.files.storagePath": 1, "artifact.files.name": 1, "artifact.files.size": 1, "artifact.files.libraryItemId":1,
    "content.size":1, "content.library_item_id":1, "content.type": 1, "content.storage_path": 1, "content.source_storage_path": 1, "content.name": 1,
    "message.content.size":1, "message.content.library_item_id":1, "message.content.type": 1, "message.content.storage_path": 1, "message.content.source_storage_path": 1, "message.content.name": 1 });
  for await (const msg of messages) {
    const chat = chats.get(JSON.stringify([msg.token, msg.chatId]));
    if (!chat) continue;
    const add = (kind: LibraryFile["kind"], path: unknown, label?: unknown, version?: string, size?: unknown) => {
      if (typeof path !== "string" || !path) return;
      const key = JSON.stringify([msg.token, msg.chatId, kind, path, version]);
      const id = createHash("sha256").update(key).digest("hex");
      const previous = rows.get(key);
      const recorded = msg.time ? new Date(msg.time) : undefined;
      const time = recorded && Number.isFinite(recorded.getTime()) ? recorded.toISOString() : "";
      const firstSeenAt = time && (!previous?.firstSeenAt || time < previous.firstSeenAt) ? time : previous?.firstSeenAt;
      const fallbackName = path.split("/").pop() || path;
      const filename = typeof label === "string" && label.trim() ? label : undefined;
      const row: LibraryFile = { id, kind, path, version, size:typeof size === "number" ? size : previous?.size, token: msg.token, project: chatNames.get(msg.token) || "",
        chatId: msg.chatId, conversation: chat.deleteTime ? "" : chat.customTitle || chat.title || "未命名会话",
        name: filename || previous?.name || fallbackName,
        time, firstSeenAt };
      if (!previous || previous.time <= time) rows.set(key, row);
      else {
        if (filename && previous.name === fallbackName) previous.name = filename;
        previous.firstSeenAt = firstSeenAt;
        previous.size ??= row.size;
      }
    };
    const meta = msg.additional_kwargs;
    if (names.has(msg.token) && Array.isArray(meta?.workspaceArtifactPaths)) {
      const sizes = new Map<string,number>();
      if (Array.isArray(meta.workspaceArtifactSizes)) {
        for (const entry of meta.workspaceArtifactSizes) {
          if (typeof entry?.path === "string" && typeof entry.size === "number") sizes.set(entry.path,entry.size);
        }
      }
      for (const path of meta.workspaceArtifactPaths) add("生成", path, undefined, meta.workspaceArtifactVersion, sizes.get(path));
    }
    const blocks = [msg.content, msg.message?.content].flatMap(content =>
      Array.isArray(content) ? content.filter(block => block?.type === "attachment") : []
    );
    const attachments = [
      ...(Array.isArray(msg.artifact?.files) ? msg.artifact.files.map((file: {storagePath?:string;name?:string;size?:number;libraryItemId?:string} | null) => ({
        path:file?.storagePath, name:file?.name, size:file?.size, origin:file?.libraryItemId,
      })) : []),
      ...blocks.map(block => ({
        path:block.source_storage_path || block.storage_path, name:block.name, size:block.size, origin:block.library_item_id,
      })),
    ];
    const referencedPaths = new Set(attachments.filter(file => file.origin && typeof file.path === "string")
      .map(file => file.path.replace(/^\/+/, "")));
    for (const block of blocks) {
      if (block.library_item_id && typeof block.storage_path === "string") {
        referencedPaths.add(block.storage_path.replace(/^\/+/, ""));
      }
    }
    for (const file of attachments) {
      if (!file.origin && typeof file.path === "string" && /^\/?chat_uploads\//.test(file.path) &&
          !referencedPaths.has(file.path.replace(/^\/+/, ""))) add("上传", file.path, file.name, undefined, file.size);
    }
  }
  const pages = db.collection("library_pages").find({owner},{projection:{sourceChat:1,name:1,time:1,createdAt:1,deletedAt:1,size:1,pinned:1,favorite:1,deleted:1,kind:1,folderId:1,originalName:1,fromTemplate:1,reference:1,appearance:1}});
  for await (const page of pages) {
    const id = page._id.toHexString();
    const source = page.sourceChat && chats.get(JSON.stringify([page.sourceChat.token,page.sourceChat.chatId]));
    rows.set(id,{id,kind:page.kind || "页面",fileOrigin:page.sourceChat ? "生成" : undefined,folderId:page.folderId,name:page.name,time:page.time,directUpload:page.kind === "上传",fromTemplate:page.fromTemplate,path:page.originalName || id,
      token:source?.token || "",project:chatNames.get(source?.token) || "",chatId:source?.chatId || "",conversation:source && !source.deleteTime ? source.customTitle || source.title || "未命名会话" : "",
      ...(page.kind === "上传" ? {createdAt:page.createdAt || page._id.getTimestamp().toISOString(),createdBy:creatorName} : {}),
      permission:"所有者",appearance:page.appearance,reference:page.reference,size:page.size,pinned:page.pinned,deletedAt:page.deletedAt,favorite:page.favorite,deleted:page.deleted});
  }
  const spaces = db.collection("library_pages").find({kind:"资料空间","members.userId":owner,deleted:{$ne:true},purging:{$ne:true}},
    {projection:{name:1,time:1,sharedBy:1,appearance:1}});
  for await (const space of spaces) {
    const shareId = space._id.toHexString();
    const id = createHash("sha256").update(JSON.stringify(["shared-space",shareId])).digest("hex");
    rows.set(id,{id,shareId,kind:"资料空间",appearance:space.appearance,name:space.name,path:"",token:"",project:space.sharedBy || "",chatId:"",conversation:"",
      time:space.time || "",permission:"可查看"});
  }
  const received = await listReceivedArtifactShares(owner);
  const sharedPageIds = received.flatMap(share => share.libraryItemId ? [new ObjectId(share.libraryItemId)] : []);
  const sharedPages = new Map((sharedPageIds.length ? await db.collection("library_pages").find(
    {_id:{$in:sharedPageIds},deleted:{$ne:true},purging:{$ne:true}},
    {projection:{owner:1,name:1,kind:1,fromTemplate:1,sourceChat:1,originalName:1}}
  ).toArray() : []).map(page => [page._id.toHexString(), page]));
  for (const share of received) {
    const page = share.libraryItemId ? sharedPages.get(share.libraryItemId) : undefined;
    if (share.libraryItemId ? page?.owner !== share.ownerId : !await canAccessArtifactSource(share.projectToken,share.ownerId,share.fileOrigin === "上传")) continue;
    const id = share._id;
    const filename = share.livePage && page ? markdownFilename(page.name) : share.filename;
    const typePath = sharedPreviewFilename(filename, page?.originalName);
    let fileOrigin = share.fileOrigin;
    if (page?.sourceChat || page?.fromTemplate) fileOrigin = "生成";
    else if (page?.kind === "上传") fileOrigin = "上传";
    rows.set(id,{id,shareId:id,permission:share.livePage && share.members[0]?.canEdit ? "可编辑" : "可查看",sharedPage:share.livePage,fileOrigin,editablePageId:share.livePage && share.members[0]?.canEdit ? share.libraryItemId : undefined,kind:"上传",name:share.livePage && page ? page.name : filename,path:typePath,time:share.members?.[0]?.invitedAt || "",token:"",chatId:"",project:share.ownerName,conversation:""});
  }
  for (const site of await listLibrarySites(owner,names)) {
    const id = siteLibraryId(site.token);
    rows.set(id,{id,siteId:site.id,siteSlug:site.slug,kind:"站点",name:site.name,path:"",token:"",project:site.ownerName || "",chatId:"",conversation:"",
      permission:site.shared ? "可查看" : "所有者",
      ...(site.shared ? {shareId:site.id} : {}),time:site.time ? new Date(site.time).toISOString() : ""});
  }
  const restores = db.collection<LibraryFile & {_id:string; owner:string; pending?:boolean}>("library_restored_versions");
  for await (const file of restores.find({owner,pending:{$ne:true},token:{$in:[...names.keys()]}},
    {projection:{_id:0,owner:0,pending:0}})) {
    const chat = chats.get(JSON.stringify([file.token,file.chatId]));
    if (!chat) continue;
    rows.set(file.id,{...file,project:names.get(file.token) || "",
      conversation:chat.deleteTime ? "" : chat.customTitle || chat.title || "未命名会话"});
  }
  const preferences = new Map((await settings.find({ owner }).toArray()).map(entry => [entry._id, entry]));
  const listed = [...rows.values()].filter(file => !preferences.get(owner + "/" + file.id)?.purged).map(file => {
    const entry = preferences.get(owner + "/" + file.id);
    return entry ? { ...file, siteSlug:file.shareId ? file.siteSlug : entry.siteSlug ?? file.siteSlug, openedAt:entry.openedAt, deletedAt:entry.deletedAt ?? file.deletedAt, folderId:entry.folderId === undefined ? file.folderId : entry.folderId, name: entry.name || file.name, favorite: entry.favorite ?? file.favorite, pinned:entry.pinned ?? file.pinned, deleted: entry.deleted ?? file.deleted } : file;
  }).sort((a, b) => b.time.localeCompare(a.time));
  return {listed,names,preferences,chats,restores};
}
