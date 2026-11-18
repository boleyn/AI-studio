import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { listLibrarySites } from "@server/library/sites";
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
  const sites = await listLibrarySites(owner,names);
  const counts = await countRecentSiteVisitors(sites.filter(site=>!site.shared).map(site=>site.token));
  return res.json(sites.map(site=>({id:site.id,name:site.name,shared:site.shared,...(site.shared ? {} : {visitors:counts.get(site.token) || 0})})));
}
