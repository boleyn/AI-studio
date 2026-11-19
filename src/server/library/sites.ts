import { createHash } from "node:crypto";
import { getMongoDb } from "@server/db/mongo";

export function siteLibraryId(projectToken:string) {
  return createHash("sha256").update(JSON.stringify(["site",projectToken])).digest("hex");
}

export async function getSiteSettings(owner: string, token: string) {
  const db = await getMongoDb();
  return db.collection<{_id:string; restricted?:boolean; name?:string; siteSlug?:string}>("library_file_settings")
    .findOne({_id:owner + "/" + siteLibraryId(token)}, {projection:{restricted:1,name:1,siteSlug:1}});
}

export async function canViewRestrictedSite(owner: string, token: string, viewer: string) {
  if (viewer === owner) return true;
  const db = await getMongoDb();
  const invitation = await db.collection("share_links").findOne(
    {ownerUserId:owner, projectToken:token, mode:"preview", "members.userId":viewer},
    {projection:{_id:1}}
  );
  return Boolean(invitation);
}

export async function listLibrarySites(owner:string, names:Map<string,string>) {
  const db = await getMongoDb();
  const links = await db.collection("share_links").aggregate([
    { $match: { ownerUserId: owner, mode: "preview", projectToken: { $in: [...names.keys()] } } },
    { $sort: { createdAt: -1, _id: -1 } },
    { $group: { _id: "$projectToken", id: { $first: "$shareId" }, memberGroups: {$push:{$ifNull:["$members.userId",[]]}}, time: { $first: "$createdAt" } } },
    { $set: {memberCount: {$size: {$reduce: {input:"$memberGroups",initialValue:[],in:{$setUnion:["$$value","$$this"]}}}}} },
  ]).toArray();
  const received = await db.collection("share_links").aggregate([
      { $match: { mode: "preview", "members.userId": owner } },
      { $lookup: { from: "projects", localField: "projectToken", foreignField: "token", as: "project" } },
      { $unwind: "$project" },
      { $match: { $expr: { $eq: ["$project.userId", "$ownerUserId"] } } },
      { $group: { _id: "$projectToken", name: { $first: "$project.name" }, ownerId: { $first: "$ownerUserId" } } },
      { $lookup: {
        from: "share_links",
        localField: "_id",
        foreignField: "projectToken",
        let: { siteOwner: "$ownerId" },
        pipeline: [
          { $match: { mode: "preview", $expr: { $eq: ["$ownerUserId", "$$siteOwner"] } } },
          { $sort: { createdAt: -1, _id: -1 } },
          { $group: {
            _id: null, id: { $first: "$shareId" }, time: { $first: "$createdAt" },
            memberGroups: { $push: { $ifNull: ["$members.userId", []] } },
          } },
        ],
        as: "publication",
      } },
      { $unwind: "$publication" },
      { $set: {
        id: "$publication.id", time: "$publication.time",
        memberCount: { $size: { $reduce: { input: "$publication.memberGroups", initialValue: [], in: { $setUnion: ["$$value", "$$this"] } } } },
      } },
      { $set: { ownerKey: { $convert: { input: "$ownerId", to: "objectId", onError: null, onNull: null } } } },
      { $lookup: { from: "users", localField: "ownerKey", foreignField: "_id", pipeline: [{ $project: { displayName: 1, username: 1 } }], as: "owner" } },
      { $project: { time:1, id:1, name:1, memberCount:1, ownerId:1, ownerName: { $ifNull: [{ $first: "$owner.displayName" }, { $first: "$owner.username" }] } } },
    ]).toArray();
  const settingsKey = (site: (typeof received)[number]) => site.ownerId + "/" + siteLibraryId(String(site._id));
  const settings = received.length ? await db.collection<{_id:string; name?:string; restricted?:boolean;siteSlug?:string}>("library_file_settings")
    .find({_id: {$in: received.map(settingsKey)}}, {projection: {name:1,restricted:1,siteSlug:1}})
    .toArray() : [];
  const sharedSettings = new Map(settings.map(entry => [entry._id, entry]));
  return [...links.map(link => ({token:String(link._id),id:String(link.id),name:names.get(link._id) || "站点",time:link.time,ownerName:undefined,slug:undefined,restricted:false,memberCount:link.memberCount,shared:false})),
    ...received.map(link=>({token:String(link._id),id:String(link.id),name:sharedSettings.get(settingsKey(link))?.name || String(link.name),time:link.time,slug:sharedSettings.get(settingsKey(link))?.siteSlug,restricted:sharedSettings.get(settingsKey(link))?.restricted === true,memberCount:link.memberCount,ownerName:link.ownerName as string | undefined,shared:true}))]
    .sort((a,b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0) || a.id.localeCompare(b.id));
}
