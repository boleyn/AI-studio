import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { canViewRestrictedSite } from "@server/library/sites";
import { getShareLink } from "@server/shares/shareStorage";
import { getProjectAccessState, readProjectFile } from "@server/projects/projectStorage";
import { isMissingStorageObject } from "@server/storage/s3";

const coverPaths = ["public/og-image.png", "og-image.png", "public/og-image.jpg", "og-image.jpg"];

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

  for (const path of coverPaths) {
    try {
      const {buffer} = await readProjectFile(share.projectToken, path);
      res.setHeader("Content-Type", path.endsWith(".png") ? "image/png" : "image/jpeg");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).send(buffer);
    } catch (error) {
      if (!isMissingStorageObject(error)) return res.status(503).end();
    }
  }
  return res.status(404).end();
}
