import { ObjectId } from "mongodb";
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
  const scope = {owner:share.ownerUserId, projectToken:share.projectToken};
  const collection = db.collection("site_database_rows");
  const {table, after} = req.query;
  if (table !== undefined) {
    if (typeof table !== "string" || !table || (after !== undefined && (typeof after !== "string" || !/^[a-f0-9]{24}$/i.test(after)))) return res.status(400).end();
    const rows = await collection.find({...scope, table, ...(typeof after === "string" ? {_id:{$gt:new ObjectId(after)}} : {})},
      {projection:{data:1}}).sort({_id:1}).limit(26).toArray();
    const page = rows.slice(0,25);
    return res.json({rows:page.map(row=>({id:String(row._id),data:row.data})), next:rows.length > 25 ? String(page[24]._id) : null});
  }
  const tables = await collection.aggregate([
    { $match: scope },
    { $group: { _id: "$table", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, name: "$_id", count: 1 } },
  ]).toArray();
  return res.json({tables});
}
