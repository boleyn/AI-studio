import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";
import { listLibrarySites, siteLibraryId } from "@server/library/sites";
import { listProjectOverviewItems } from "@server/projects/projectStorage";

import { countRecentSiteVisitors } from "@server/shares/siteVisits";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");
  const owner = String(auth.user._id);
  if (req.method === "DELETE") {
    const id = req.query.id;
    if (typeof id !== "string" || !id) return res.status(400).end();
    const links = (await getMongoDb()).collection("share_links");
    const link = await links.findOne({shareId:id, ownerUserId:owner, mode:"preview"},{projection:{projectToken:1}});
    if (!link || typeof link.projectToken !== "string") return res.status(404).end();
    await links.deleteMany({projectToken:link.projectToken, ownerUserId:owner, mode:"preview"});
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, DELETE");
    return res.status(405).end();
  }

  const projects = await listProjectOverviewItems(owner);
  const names = new Map(projects.map(project => [project.token, project.name]));
  const sites = await listLibrarySites(owner,names);
  const settings = (await getMongoDb()).collection<{_id:string;owner:string;name?:string;deleted?:boolean;purged?:boolean}>("library_file_settings");
  const key = (token:string) => owner + "/" + siteLibraryId(token);
  const entries = await settings.find({owner,_id:{$in:sites.map(site=>key(site.token))}}).toArray();
  const preferences = new Map(entries.map(entry=>[entry._id,entry]));
  const visible = sites.flatMap(site=>{
    const entry = preferences.get(key(site.token));
    if (entry?.deleted || entry?.purged) return [];
    return [{...site,name:entry?.name || site.name}];
  });
  const counts = await countRecentSiteVisitors(visible.filter(site=>!site.shared).map(site=>site.token));
  return res.json(visible.map(site=>({id:site.id,name:site.name,publishedAt:site.time,shared:site.shared,ownerName:site.ownerName,...(site.shared ? {} : {libraryId:siteLibraryId(site.token),editUrl:"/project/" + encodeURIComponent(site.token),visitors:counts.get(site.token) || 0})})));
}
