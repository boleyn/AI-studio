import sharp from "sharp";
import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { canViewRestrictedSite } from "@server/library/sites";
import { getShareLink } from "@server/shares/shareStorage";
import { getProjectAccessState, listProjectFilesByPrefix, readProjectFile } from "@server/projects/projectStorage";
import { isMissingStorageObject } from "@server/storage/s3";

const coverExtensions = [
  "png", "jpg", "jpeg", "webp", "avif",
] as const;
const covers = coverExtensions.flatMap(extension =>
  ["public/og-image", "og-image"].map(base => base+"."+extension),
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const auth = await requireAuth(req,res);
  if (!auth) return;
  const share = typeof req.query.shareId === "string" && await getShareLink(req.query.shareId);
  if (!share || share.mode !== "preview" ||
      await getProjectAccessState(share.projectToken, share.ownerUserId) !== "ok" ||
      !await canViewRestrictedSite(share.ownerUserId, share.projectToken, String(auth.user._id))) return res.status(404).end();

  let files: Set<string>;
  try {
    const matches = await Promise.all(["public/og-image.", "og-image."].map(prefix =>
      listProjectFilesByPrefix(share.projectToken, prefix)));
    files = new Set(matches.flat().map(path => path.replace(/^\/+/,"")));
  } catch {
    return res.status(503).end();
  }
  for (const path of covers) {
    if (!files.has(path)) continue;
    try {
      const {buffer} = await readProjectFile(share.projectToken, path);
      const thumbnail = await sharp(buffer).rotate().resize({
        width: 720, height: 480, fit: "inside", withoutEnlargement: true,
      }).webp({quality:82}).toBuffer().catch(() => null);
      if (!thumbnail) continue;
      res.setHeader("Content-Type", "image/webp");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).send(thumbnail);
    } catch (error) {
      if (!isMissingStorageObject(error)) return res.status(503).end();
    }
  }
  return res.status(404).end();
}
