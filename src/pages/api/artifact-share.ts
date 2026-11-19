import { sharedPreviewFilename, markdownFilename } from "@/types/library";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@server/db/mongo";
import { getObjectFromStorage, isMissingStorageObject, isStorageUnavailable } from "@server/storage/s3";
import { assertChatScopedStoragePath } from "./core/chat/files/shared";
import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { findUserByUsername } from "@server/auth/userStore";
import { canAccessArtifactSource } from "@server/chat/tokenAccess";
import { readProjectArtifactVersion, readProjectFile } from "@server/projects/projectStorage";
import {
  createArtifactShare,
  getArtifactShare,
  readArtifactShareSnapshot,
  updateArtifactShareMember,
} from "@server/shares/artifactShareStorage";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const userId = String(auth.user._id);
  res.setHeader("Cache-Control", "private, no-store");
  const body = req.body || {};
  const id = typeof req.query.id === "string" ? req.query.id : "";

  try {
    if (req.method === "POST") {
      const token = typeof body.token === "string" ? body.token : "";
      const path = typeof body.path === "string" ? body.path : "";
      const version = typeof body.version === "string" ? body.version : "";
      let bytes:Buffer;
      let livePage = false;
      let fileOrigin: "上传" | "生成" = "生成";
      let filename = path;
      const libraryItemId = typeof body.libraryItemId === "string" ? body.libraryItemId : undefined;
      if (libraryItemId) {
        if (!/^[a-f0-9]{24}$/.test(libraryItemId)) return res.status(400).json({ error: "文件引用无效，请从资料空间重新选择文件" });
        const native = await (await getMongoDb()).collection("library_pages").findOne({_id:new ObjectId(libraryItemId),owner:userId,deleted:{$ne:true},purging:{$ne:true}});
        if (!native || (native.kind && !["上传","页面"].includes(native.kind))) return res.status(404).json({ error: "共享文件不可用" });
        filename = native.name;
        if (native.kind === "上传") {
          fileOrigin = native.sourceChat || native.fromTemplate ? "生成" : "上传";
          bytes = (await getObjectFromStorage({key:native.storageKey})).buffer;
        } else {
          livePage = true;
          bytes = Buffer.alloc(0);
          filename = markdownFilename(native.name);
        }
      } else {
        if (!token || !path) return res.status(400).json({ error: "缺少工作成果" });
        if (!await canAccessArtifactSource(token,userId,body.chatUpload === true)) return res.status(404).json({ error: "共享文件不可用" });
        if (body.chatUpload === true) {
          fileOrigin = "上传";
          if (typeof body.chatId !== "string" || !body.chatId) return res.status(400).json({ error: "文件引用无效，请从资料空间重新选择文件" });
          const key = assertChatScopedStoragePath({storagePath:path,token,chatId:body.chatId});
          bytes = (await getObjectFromStorage({key})).buffer;
        } else {
          if (version && !/^[a-f0-9]{32}$/.test(version)) return res.status(400).json({error:"无效的成果版本"});
          const source = await (version ? readProjectArtifactVersion(token,version,path) : readProjectFile(token,path));
          bytes = source.buffer;
        }
      }
      const share = await createArtifactShare({projectToken:libraryItemId ? "" : token,libraryItemId,livePage,fileOrigin:livePage ? undefined : fileOrigin,ownerId:userId,ownerName:auth.user.username,path:filename,bytes});
      if (!share) throw new Error("Share creation did not return a record");
      return res.status(201).json({ id: share._id, filename: share.filename, owner: share.ownerName, members: share.members, livePage:share.livePage });
    }

    if (req.method !== "GET" && req.method !== "PATCH") {
      res.setHeader("Allow", ["GET", "POST", "PATCH"]);
      return res.status(405).end();
    }
    const share = await getArtifactShare(id);
    if (!share) return res.status(404).json({ error: "共享文件不可用" });
    const owner = share.ownerId === userId;
    if (!owner && !share.members.some(member => member.userId === userId)) {
      return res.status(404).json({ error: "共享文件不可用" });
    }
    const native = share.libraryItemId ? await (await getMongoDb()).collection("library_pages").findOne(
      {_id:new ObjectId(share.libraryItemId),owner:share.ownerId,deleted:{$ne:true},purging:{$ne:true}},
      {projection:share.livePage ? {name:1,body:1} : {originalName:1}}
    ) : null;
    if (share.libraryItemId ? !native : !await canAccessArtifactSource(share.projectToken,share.ownerId,share.fileOrigin === "上传")) {
      return res.status(404).json({ error: "共享文件不可用" });
    }
    const filename = share.livePage && native ? markdownFilename(native.name) : share.filename;

    const previewName = sharedPreviewFilename(filename,native?.originalName);

    if (req.method === "PATCH") {
      if (!owner) return res.status(403).json({ error: "仅所有者可管理访问权限" });
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const member = body.remove === true || body.userId !== undefined
        ? share.members.find((item) => body.userId !== undefined ? item.userId === body.userId : item.username === username)
        : username && username.length <= 100
          ? await findUserByUsername(username).then((user) => user ? { userId: String(user._id), username: user.username } : undefined)
          : undefined;
      if (!member || member.userId === userId) return res.status(400).json({ error: "请选择有效的 Hermes 账号" });
      const action = body.remove === true ? "remove" : body.userId !== undefined ? "edit" : "invite";
      const updated = await updateArtifactShareMember(id, userId, {...member, ...(share.livePage && typeof body.canEdit === "boolean" ? {canEdit:body.canEdit} : {})}, action);
      return res.status(200).json({ members: updated?.members ?? [] });
    }

    if (req.query.file === "1") {
      if (share.livePage && typeof native?.body !== "string") return res.status(422).json({error:"共享页面正文无法读取"});
      const buffer = share.livePage && native
        ? Buffer.from("# " + native.name + "\n\n" + native.body)
        : (await readArtifactShareSnapshot(id)).buffer;
      const markdown = share.livePage || /\.(md|markdown)$/i.test(native?.originalName || filename);
      res.setHeader("Content-Type", markdown ? "text/markdown; charset=utf-8" : "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(previewName).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`);
      return res.status(200).send(buffer);
    }

    return res.status(200).json({ filename, previewName, viewerLibraryId:owner ? share.libraryItemId : id, livePage:Boolean(share.livePage), owner: share.ownerName, editablePageId:share.livePage && (owner || share.members.some(m => m.userId === userId && m.canEdit)) ? share.libraryItemId : undefined });
  } catch (error) {
    if (isMissingStorageObject(error)) return res.status(404).json({error:"共享文件不存在"});
    if (isStorageUnavailable(error)) return res.status(503).json({error:"文件存储暂时不可用，请稍后重试"});
    console.error("Artifact share request failed", error);
    return res.status(500).json({ error: "暂时无法处理共享文件" });
  }
}
