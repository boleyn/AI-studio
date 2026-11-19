import { getMongoDb } from "@server/db/mongo";
import { verifyAuthToken } from "@server/auth/jwt";
import type { ShareLinkData } from "./shareStorage";

interface SiteVisit {
  _id: string;
  projectToken: string;
  viewer: string;
  shareId: string;
  visitedAt: Date;
}

export async function recordSiteRequest(share: ShareLinkData) {
  const day = new Date().toISOString().slice(0,10);
  const db = await getMongoDb();
  await db.collection<{_id:string;projectToken:string;day:string;requests:number}>("site_daily_requests").updateOne(
    {_id:JSON.stringify([share.projectToken,day])},
    {$setOnInsert:{projectToken:share.projectToken,day},$inc:{requests:1}},
    {upsert:true},
  );
}

export async function recordSiteVisit(share: ShareLinkData, cookie?: string) {
  await recordSiteRequest(share);
  if (!cookie) return;
  let viewer: string;
  try { viewer = verifyAuthToken(cookie).sub; } catch { return; }
  if (!viewer || viewer === share.ownerUserId) return;
  const db = await getMongoDb();
  await db.collection<SiteVisit>("site_visits").updateOne(
    { _id: JSON.stringify([share.projectToken, viewer]) },
    { $set: { projectToken: share.projectToken, viewer, shareId: share.shareId }, $currentDate: { visitedAt: true } },
    { upsert: true },
  );
  const day = new Date().toISOString().slice(0, 10);
  await db.collection<{_id:string;projectToken:string;day:string;views:number;pages?:Record<string,number>;viewer:string}>("site_daily_visits").updateOne(
    { _id: JSON.stringify([share.projectToken, day, viewer]) },
    { $setOnInsert: {projectToken:share.projectToken, day, viewer}, $inc: {views:1,["pages."+share.shareId]:1} },
    { upsert:true },
  );
}

export function siteReportDates(days: number) {
  const now = Date.now();
  return Array.from({length:days}, (_, index) =>
    new Date(now - (days - 1 - index) * 86400000).toISOString().slice(0,10));
}

export async function countRecentSiteVisitors(tokens: string[]) {
  const db = await getMongoDb();
  const dates = siteReportDates(30);
  const totals = await db.collection("site_daily_visits").aggregate<{ _id: string; count: number }>([
    { $match: { projectToken: { $in: tokens }, day: { $gte: dates[0], $lte: dates[29] } } },
    { $group: { _id: {project:"$projectToken", viewer:"$viewer"} } },
    { $group: { _id: "$_id.project", count: { $sum: 1 } } },
  ]).toArray();
  return new Map(totals.map(row => [row._id, row.count]));
}
