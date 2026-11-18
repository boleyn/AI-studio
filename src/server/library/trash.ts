import { type Db, ObjectId } from "mongodb";
import { getMongoDb } from "@server/db/mongo";
import { deleteStorageObjects } from "@server/storage/s3";

export async function purgeLibraryItem(db: Db, owner: string, id: string, cutoff?: string) {
  const settings = db.collection<{_id:string; owner:string; folderId?:string; deleted?:boolean; deletedAt?:string; purged?:boolean}>("library_file_settings");
  const deleted = {owner, deleted:true, ...(cutoff ? {deletedAt:{$lte:cutoff}} : {})};
  if (id.length === 64) {
    const result = await settings.updateOne({...deleted, _id:owner + "/" + id}, {$set:{purged:true}});
    return result.matchedCount ? 204 : 404;
  }
  const pages = db.collection("library_pages");
  const filter = {...deleted, _id:new ObjectId(id)};
  if (await pages.findOne({owner,folderId:id}) || await settings.findOne({owner,folderId:id,purged:{$ne:true}})) return 409;
  const item = await pages.findOneAndUpdate(filter, {$set:{purging:true}}, {returnDocument:"after"});
  if (!item) return 404;
  if (item.storageKey) await deleteStorageObjects({keys:[item.storageKey]});
  await pages.deleteOne({...filter,purging:true});
  await settings.deleteOne({owner,_id:owner + "/" + id});
  return 204;
}

export async function expireLibraryTrash(db: Db, now = Date.now()) {
  const cutoff = new Date(now - 30 * 86400000).toISOString();
  const expired = {deleted:true, deletedAt:{$lte:cutoff}};
  await db.collection("library_file_settings").updateMany({...expired,purged:{$ne:true}}, {$set:{purged:true}});
  const items = db.collection("library_pages").find(expired, {projection:{owner:1}});
  for await (const item of items) {
    try { await purgeLibraryItem(db, item.owner, item._id.toHexString(), cutoff); }
    catch { console.error("[library] trash item cleanup failed"); }
  }
}

export function startLibraryTrashWorker() {
  const state = globalThis as typeof globalThis & {libraryTrashTimer?:NodeJS.Timeout};
  if (state.libraryTrashTimer) return;
  let busy = false;
  const sweep = async () => {
    if (busy) return;
    busy = true;
    try { await expireLibraryTrash(await getMongoDb()); }
    catch { console.error("[library] trash cleanup failed"); }
    finally { busy = false; }
  };
  state.libraryTrashTimer = setInterval(() => void sweep(), 60 * 60 * 1000);
  state.libraryTrashTimer.unref();
  void sweep();
}
