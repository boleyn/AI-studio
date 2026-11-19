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
  if (req.method === "PATCH") {
    const {id,slug} = req.body || {};
    if (typeof id !== "string" || typeof slug !== "string" || slug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return res.status(400).end();
    const db = await getMongoDb();
    const link = await db.collection("share_links").findOne({shareId:id,ownerUserId:owner,mode:"preview"});
    if (!link) return res.status(404).end();
    const settings = db.collection<{_id:string;owner:string;siteSlug:string;siteProjectToken:string;siteShareId:string}>("library_file_settings");
    await settings.createIndex({siteSlug:1},{unique:true,partialFilterExpression:{siteSlug:{$type:"string"}}});
    try {
      await settings.updateOne({_id:owner+"/"+siteLibraryId(link.projectToken)},{$set:{owner,siteSlug:slug,siteProjectToken:link.projectToken,siteShareId:id}},{upsert:true});
    } catch (error) {
      if ((error as {code?:number}).code === 11000) return res.status(409).end();
      throw error;
    }
    return res.status(204).end();
  }
  if (req.method === "DELETE") {
    const id = req.query.id;
    if (typeof id !== "string" || !id) return res.status(400).end();
    const db = await getMongoDb();
    const links = db.collection("share_links");
    const link = await links.findOne({shareId:id, ownerUserId:owner, mode:"preview"},{projection:{projectToken:1}});
    if (!link || typeof link.projectToken !== "string") return res.status(404).end();
    await db.collection<{_id:string;owner:string}>("library_file_settings").updateOne(
      {_id:owner+"/"+siteLibraryId(link.projectToken),owner},
      {$unset:{siteSlug:"",siteProjectToken:"",siteShareId:""}}
    );
    const publications = {projectToken:link.projectToken, ownerUserId:owner, mode:"preview"};
    const shareIds = await links.distinct("shareId", publications);
    await db.collection("site_domains").deleteMany({shareId:{$in:shareIds}});
    await links.deleteMany({...publications, shareId:{$in:shareIds}});
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, PATCH, DELETE");
    return res.status(405).end();
  }

  const projects = await listProjectOverviewItems(owner);
  const names = new Map(projects.map(project => [project.token, project.name]));
  const sites = await listLibrarySites(owner,names);
  const settings = (await getMongoDb()).collection<{_id:string;owner:string;name?:string;deleted?:boolean;purged?:boolean;restricted?:boolean;siteSlug?:string}>("library_file_settings");
  const key = (token:string) => owner + "/" + siteLibraryId(token);
  const entries = await settings.find({owner,_id:{$in:sites.map(site=>key(site.token))}}).toArray();
  const preferences = new Map(entries.map(entry=>[entry._id,entry]));
  const visible = sites.flatMap(site=>{
    const entry = preferences.get(key(site.token));
    if (entry?.deleted || entry?.purged) return [];
    return [{...site,name:entry?.name || site.name}];
  });
  const counts = await countRecentSiteVisitors(visible.filter(site=>!site.shared).map(site=>site.token));
  return res.json(visible.map(site=>({slug:site.shared ? site.slug : preferences.get(key(site.token))?.siteSlug,restricted:site.shared ? site.restricted : Boolean(preferences.get(key(site.token))?.restricted),memberCount:site.memberCount,id:site.id,name:site.name,publishedAt:site.time,shared:site.shared,ownerName:site.ownerName,libraryId:siteLibraryId(site.token),...(site.shared ? {} : {projectToken:site.token,editUrl:"/project/" + encodeURIComponent(site.token),visitors:counts.get(site.token) || 0})})));
}
