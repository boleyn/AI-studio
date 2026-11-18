import { getMongoDb } from "@server/db/mongo";

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
      { $group: { _id: "$projectToken", id: { $first: "$shareId" }, name: { $first: "$project.name" }, time: { $first: "$createdAt" } } },
      { $project: { _id: 1, time:1, id: 1, name: 1, shared: { $literal: true } } },
    ]).toArray();
  return [...links.map(link => ({token:String(link._id),id:String(link.id),name:names.get(link._id) || "站点",time:link.time,shared:false})),
    ...received.map(link=>({token:String(link._id),id:String(link.id),name:String(link.name),time:link.time,shared:true}))];
}
