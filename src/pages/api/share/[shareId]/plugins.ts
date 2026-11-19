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
  const plugins = await db.collection("site_plugins").find(
    { owner: share.ownerUserId, projectToken: share.projectToken },
    { projection: { _id: 0, id: 1, name: 1 } },
  ).sort({name:1}).toArray();
  return res.json({plugins});
}
