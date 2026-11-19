import { createHash } from "node:crypto";
import { getMongoDb } from "@server/db/mongo";

export function siteLibraryId(projectToken:string) {
  return createHash("sha256").update(JSON.stringify(["site",projectToken])).digest("hex");
}

export async function listLibrarySites(owner:string, names:Map<string,string>) {
  const links = await (await getMongoDb()).collection("share_links").aggregate([
    { $match: { ownerUserId: owner, mode: "preview", projectToken: { $in: [...names.keys()] } } },
    { $sort: { createdAt: -1, _id: -1 } },
    { $group: { _id: "$projectToken", id: { $first: "$shareId" }, time: { $first: "$createdAt" } } },
    { $sort: { time: -1 } },
  ]).toArray();
  const received = await (await getMongoDb()).collection("share_links").aggregate([
      { $match: { mode: "preview", "members.userId": owner } },
      { $lookup: { from: "projects", localField: "projectToken", foreignField: "token", as: "project" } },
      { $unwind: "$project" },
      { $match: { $expr: { $eq: ["$project.userId", "$ownerUserId"] } } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: "$projectToken", id: { $first: "$shareId" }, name: { $first: "$project.name" }, ownerId: { $first: "$ownerUserId" }, time: { $first: "$createdAt" } } },
      { $set: { ownerKey: { $convert: { input: "$ownerId", to: "objectId", onError: null, onNull: null } } } },
      { $lookup: { from: "users", localField: "ownerKey", foreignField: "_id", pipeline: [{ $project: { displayName: 1, username: 1 } }], as: "owner" } },
      { $project: { time:1, id:1, name:1, ownerName: { $ifNull: [{ $first: "$owner.displayName" }, { $first: "$owner.username" }] } } },
    ]).toArray();
  return [...links.map(link => ({token:String(link._id),id:String(link.id),name:names.get(link._id) || "站点",time:link.time,ownerName:undefined,shared:false})),
    ...received.map(link=>({token:String(link._id),id:String(link.id),name:String(link.name),time:link.time,ownerName:link.ownerName as string | undefined,shared:true}))];
}
