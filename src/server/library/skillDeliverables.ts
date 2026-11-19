import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@server/db/mongo";
import { uploadObjectToStorage } from "@server/storage/s3";

export async function saveLinkedSkillFiles(owner: string, token: string, chatId: string, messageId: string,
  reply: string, files: Record<string, {code: string}>) {
  const linked = new Set<string>();
  for (const match of reply.matchAll(/\]\(<?sandbox:(\/[^)>\n]+)>?\)/g)) {
    let path = match[1];
    try { path = decodeURIComponent(path); } catch { /* A filename may contain a literal percent sign. */ }
    const relative = path.replace(/^\/mnt\/data\//, "").replace(/^\/+/, "");
    const key = [path, "/" + relative, relative].find(candidate => Object.hasOwn(files, candidate));
    if (key) linked.add(key);
  }
  const failed: string[] = [];
  if (!linked.size) return failed;
  const items = (await getMongoDb()).collection("library_pages");
  for (const path of linked) {
    const name = path.split("/").pop();
    if (!name) continue;
    const digest = createHash("sha256").update(JSON.stringify([owner,token,chatId,messageId,path])).digest("hex");
    const _id = new ObjectId(digest.slice(0,24));
    const storageKey = "library/" + owner + "/" + _id.toHexString();
    const code = files[path].code;
    const encoded = /^data:[^,]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(code);
    const body = encoded ? Buffer.from(encoded[1],"base64") : Buffer.from(code);
    try {
      await uploadObjectToStorage({key:storageKey,body,contentType:"application/octet-stream"});
      const time = new Date().toISOString();
      await items.updateOne({_id,owner},{$setOnInsert:{name,originalName:name,kind:"上传",sourceChat:{token,chatId},
        storageKey,size:body.length,time,createdAt:time}},{upsert:true});
    } catch {
      failed.push(name);
    }
  }
  return failed;
}
