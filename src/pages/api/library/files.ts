import type { NextApiRequest, NextApiResponse } from "next";
import { ObjectId } from "mongodb";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";
import { deleteStorageObjects, getObjectFromStorage, uploadObjectToStorage } from "@server/storage/s3";
import { MAX_FILE_SIZE } from "../core/chat/files/shared";
import { referenceTypes, type LibraryFile, type ImageReference } from "@/types/library";

export const config = { api: { bodyParser: false, responseLimit: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req,res);
  if (!auth) return;
  const owner = String(auth.user._id);
  const items = (await getMongoDb()).collection("library_pages");
  res.setHeader("Cache-Control","private, no-store");
  if (req.method === "GET") {
    const id = req.query.id;
    if (typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id)) return res.status(400).end();
    const item = await items.findOne({_id:new ObjectId(id),owner,kind:"上传",deleted:{$ne:true}});
    if (!item) return res.status(404).end();
    const {buffer} = await getObjectFromStorage({key:item.storageKey});
    res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(item.name));
    res.setHeader("Content-Type","application/octet-stream");
    res.setHeader("X-Content-Type-Options","nosniff");
    return res.send(buffer);
  }
  if (req.method !== "POST") return res.setHeader("Allow","POST, GET").status(405).end();
  const name = req.query.name;
  if (typeof name !== "string" || !name.trim() || name.length > 255 || /[\/\\\x00-\x1f]/.test(name)) return res.status(400).end();
  let reference: ImageReference | undefined;
  if (req.query.referenceType !== undefined) {
    const type = referenceTypes.find(value => value === req.query.referenceType);
    const label = req.query.referenceName ?? "";
    if (!type || typeof label !== "string" || label.length > 120 || !/\.(png|jpe?g|webp|gif|avif)$/i.test(name)) return res.status(400).end();
    reference = {type, name:label.trim()};
  }
  const folderId = req.query.folderId;
  if (folderId !== undefined && (typeof folderId !== "string" || !/^[a-f0-9]{24}$/.test(folderId) ||
      !await items.findOne({_id:new ObjectId(folderId),owner,kind:{$in:["文件夹","资料空间"]},deleted:{$ne:true}}))) return res.status(400).end();
  let size = 0;
  const chunks:Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_FILE_SIZE) return res.status(413).json({error:"文件超过上传大小限制"});
    chunks.push(buffer);
  }
  const _id = new ObjectId();
  const id = _id.toHexString();
  const storageKey = "library/" + owner + "/" + id;
  const time = new Date().toISOString();
  await uploadObjectToStorage({key:storageKey,body:Buffer.concat(chunks),contentType:"application/octet-stream"});
  try {
    await items.insertOne({_id,owner,name,time,size,reference,folderId,kind:"上传",storageKey,originalName:name});
  } catch (error) {
    await deleteStorageObjects({keys:[storageKey]});
    throw error;
  }
  const file:LibraryFile = {id,kind:"上传",directUpload:true,size,reference,name,path:name,time,folderId,token:"",project:"",conversation:"",chatId:""};
  return res.status(201).json(file);
}
