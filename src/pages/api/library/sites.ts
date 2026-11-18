import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";
import { listProjectOverviewItems } from "@server/projects/projectStorage";

import { countRecentSiteVisitors } from "@server/shares/siteVisits";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  const owner = String(auth.user._id);
  const projects = await listProjectOverviewItems(owner);
  const names = new Map(projects.map(project => [project.token, project.name]));
  const links = await (await getMongoDb()).collection("share_links").aggregate([
    { $match: { ownerUserId: owner, mode: "preview", projectToken: { $in: [...names.keys()] } } },
    { $sort: { createdAt: -1, _id: -1 } },
    { $group: { _id: "$projectToken", id: { $first: "$shareId" }, time: { $first: "$createdAt" } } },
    { $sort: { time: -1 } },
  ]).toArray();
  const [counts, received] = await Promise.all([
    countRecentSiteVisitors(links.map(link => link._id)),
    (await getMongoDb()).collection("share_links").aggregate([
      { $match: { mode: "preview", "members.userId": owner } },
      { $lookup: { from: "projects", localField: "projectToken", foreignField: "token", as: "project" } },
      { $unwind: "$project" },
      { $match: { $expr: { $eq: ["$project.userId", "$ownerUserId"] } } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: "$projectToken", id: { $first: "$shareId" }, name: { $first: "$project.name" } } },
      { $project: { _id: 0, id: 1, name: 1, shared: { $literal: true } } },
    ]).toArray(),
  ]);
  return res.json([...links.map(link => ({
    id: link.id, name: names.get(link._id), visitors: counts.get(link._id) || 0, shared: false,
  })), ...received]);
}
