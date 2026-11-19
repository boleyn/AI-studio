import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { findUserByUsername } from "@server/auth/userStore";
import { getMongoDb } from "@server/db/mongo";
import { getProjectAccessState } from "@server/projects/projectStorage";

import { siteLibraryId, getSiteSettings } from "@server/library/sites";

interface SiteLink {
  shareId: string;
  ownerUserId: string;
  projectToken: string;
  mode: string;
  members?: { userId: string; username: string }[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET" && req.method !== "PATCH") {
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).end();
  }
  const ownerUserId = String(auth.user._id);
  const links = (await getMongoDb()).collection<SiteLink>("share_links");
  const shareId = typeof req.query.shareId === "string" ? req.query.shareId : "";
  const filter = { shareId, ownerUserId, mode: "preview" };
  const link = await links.findOne(filter);
  if (!link || await getProjectAccessState(link.projectToken, ownerUserId) !== "ok") {
    return res.status(404).json({ error: "找不到站点" });
  }
  const siteLinks = {ownerUserId, projectToken:link.projectToken, mode:"preview"};
  if (req.method === "PATCH" && typeof req.body?.restricted === "boolean") {
    const db = await getMongoDb();
    await db.collection<{_id:string; owner:string; restricted:boolean}>("library_file_settings").updateOne(
      {_id:ownerUserId+"/"+siteLibraryId(link.projectToken)}, {$set:{owner:ownerUserId,restricted:req.body.restricted}}, {upsert:true}
    );
  } else if (req.method === "PATCH") {
    const name = req.body?.username;
    if (typeof name !== "string" || !name.trim() || name.length > 100) return res.status(400).json({ error: "请输入账号名称" });
    if (req.body.remove === true) {
      await links.updateMany(siteLinks, { $pull: { members: { username: name } } });
    } else {
      const member = await findUserByUsername(name.trim());
      if (!member || String(member._id) === ownerUserId) return res.status(400).json({ error: "请选择其他有效账号" });
      await links.updateOne(filter, { $addToSet: { members: { userId: String(member._id), username: member.username } } });
    }
  }
  const members = await links.aggregate([
    {$match:siteLinks}, {$unwind:"$members"},
    {$group:{_id:"$members.userId",username:{$first:"$members.username"}}},
    {$sort:{username:1}}, {$project:{_id:0,username:1}}
  ]).toArray();
  return res.json({ id: shareId, owner: auth.user.username, restricted:(await getSiteSettings(ownerUserId,link.projectToken))?.restricted === true, members });
}
