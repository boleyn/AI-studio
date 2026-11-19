import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";
import { getShareLink } from "@server/shares/shareStorage";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.setHeader("Allow", "GET").status(405).end();
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const share = typeof req.query.shareId === "string" && await getShareLink(req.query.shareId);
  if (!share || share.mode !== "preview" || share.ownerUserId !== String(auth.user._id)) return res.status(404).end();
  const db = await getMongoDb();
  const tables = await db.collection("site_database_rows").aggregate([
    { $match: { owner: share.ownerUserId, projectToken: share.projectToken } },
    { $group: { _id: "$table", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, name: "$_id", count: 1 } },
  ]).toArray();
  return res.json({tables});
}
