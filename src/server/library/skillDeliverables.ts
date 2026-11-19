import { createHash } from "node:crypto";
import { fromMarkdown } from "mdast-util-from-markdown";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@server/db/mongo";
import { uploadObjectToStorage } from "@server/storage/s3";

export async function saveLinkedSkillFiles(owner: string, token: string, chatId: string, messageId: string,
  reply: string, files: Record<string, {code: string}>) {
  const linked = new Set<string>();
  const urls: string[] = [];
  const references = new Set<string>();
  const definitions = new Map<string,string>();
  const nodes = [...fromMarkdown(reply).children].reverse();
  while (nodes.length) {
    const node = nodes.pop()!;
    if (node.type === "link" || node.type === "image") urls.push(node.url);
    if (node.type === "linkReference" || node.type === "imageReference") references.add(node.identifier);
    if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier,node.url);
    if ("children" in node) for (let i = node.children.length - 1; i >= 0; i--) nodes.push(node.children[i]);
  }
  for (const id of references) {
    const url = definitions.get(id);
    if (url) urls.push(url);
  }
  for (const url of urls) {
    if (!url.startsWith("sandbox:/")) continue;
    let path = url.slice("sandbox:".length);
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
