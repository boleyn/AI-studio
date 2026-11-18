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

export async function recordSiteVisit(share: ShareLinkData, cookie?: string) {
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
}

export async function countRecentSiteVisitors(tokens: string[]) {
  const db = await getMongoDb();
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const totals = await db.collection<SiteVisit>("site_visits").aggregate<{ _id: string; count: number }>([
    { $match: { projectToken: { $in: tokens }, visitedAt: { $gte: cutoff } } },
    { $group: { _id: "$projectToken", count: { $sum: 1 } } },
  ]).toArray();
  return new Map(totals.map(row => [row._id, row.count]));
}
