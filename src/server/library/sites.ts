import { createHash } from "node:crypto";
import { getMongoDb } from "@server/db/mongo";

export function siteLibraryId(projectToken:string) {
  return createHash("sha256").update(JSON.stringify(["site",projectToken])).digest("hex");
}

export async function siteVisibility(owner: string, token: string) {
  const db = await getMongoDb();
  const entry = await db.collection<{_id:string; restricted?:boolean}>("library_file_settings")
    .findOne({_id:owner + "/" + siteLibraryId(token)}, {projection:{restricted:1}});
  return entry?.restricted === true;
}

export async function listLibrarySites(owner:string, names:Map<string,string>) {
  const db = await getMongoDb();
  const links = await db.collection("share_links").aggregate([
    { $match: { ownerUserId: owner, mode: "preview", projectToken: { $in: [...names.keys()] } } },
    { $sort: { createdAt: -1, _id: -1 } },
    { $group: { _id: "$projectToken", id: { $first: "$shareId" }, memberCount: {$first:{$size:{$ifNull:["$members",[]]}}}, time: { $first: "$createdAt" } } },
    { $sort: { time: -1 } },
  ]).toArray();
  const received = await db.collection("share_links").aggregate([
      { $match: { mode: "preview", "members.userId": owner } },
      { $lookup: { from: "projects", localField: "projectToken", foreignField: "token", as: "project" } },
      { $unwind: "$project" },
      { $match: { $expr: { $eq: ["$project.userId", "$ownerUserId"] } } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: "$projectToken", id: { $first: "$shareId" }, memberCount: {$first:{$size:{$ifNull:["$members",[]]}}}, name: { $first: "$project.name" }, ownerId: { $first: "$ownerUserId" }, time: { $first: "$createdAt" } } },
      { $set: { ownerKey: { $convert: { input: "$ownerId", to: "objectId", onError: null, onNull: null } } } },
      { $lookup: { from: "users", localField: "ownerKey", foreignField: "_id", pipeline: [{ $project: { displayName: 1, username: 1 } }], as: "owner" } },
      { $project: { time:1, id:1, name:1, memberCount:1, ownerId:1, ownerName: { $ifNull: [{ $first: "$owner.displayName" }, { $first: "$owner.username" }] } } },
    ]).toArray();
  const settingsKey = (site: (typeof received)[number]) => site.ownerId + "/" + siteLibraryId(String(site._id));
  const settings = received.length ? await db.collection<{_id:string; name?:string; restricted?:boolean}>("library_file_settings")
    .find({_id: {$in: received.map(settingsKey)}}, {projection: {name:1,restricted:1}})
    .toArray() : [];
  const sharedSettings = new Map(settings.map(entry => [entry._id, entry]));
  return [...links.map(link => ({token:String(link._id),id:String(link.id),name:names.get(link._id) || "站点",time:link.time,ownerName:undefined,restricted:false,memberCount:link.memberCount,shared:false})),
    ...received.map(link=>({token:String(link._id),id:String(link.id),name:sharedSettings.get(settingsKey(link))?.name || String(link.name),time:link.time,restricted:sharedSettings.get(settingsKey(link))?.restricted === true,memberCount:link.memberCount,ownerName:link.ownerName as string | undefined,shared:true}))];
}
