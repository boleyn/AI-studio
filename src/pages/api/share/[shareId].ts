import type { NextApiRequest, NextApiResponse } from "next";

import { requireAuth } from "@server/auth/session";
import { canViewRestrictedSite, siteVisibility } from "@server/library/sites";
import { getProject } from "@server/projects/projectStorage";
import { getShareLink } from "@server/shares/shareStorage";

import { recordSiteRequest } from "@server/shares/siteVisits";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const shareId = typeof req.query.shareId === "string" ? req.query.shareId.trim() : "";
  if (!shareId) {
    res.status(400).json({ error: "缺少 shareId" });
    return;
  }

  const share = await getShareLink(shareId);
  if (!share) {
    res.status(404).json({ error: "分享链接不存在" });
    return;
  }

  res.setHeader("Cache-Control", "private, no-store");
  if (share.mode === "preview" && await siteVisibility(share.ownerUserId, share.projectToken)) {
    const auth = await requireAuth(req,res);
    if (!auth) return;
    const userId = String(auth.user._id);
    if (!await canViewRestrictedSite(share.ownerUserId, share.projectToken, userId)) {
      return res.status(403).json({error:"当前账号没有访问此站点的权限"});
    }
  }

  const project = await getProject(share.projectToken);
  if (!project) {
    res.status(404).json({ error: "来源项目不存在" });
    return;
  }

  if (share.mode === "preview") {
    await recordSiteRequest(share).catch(() => console.warn("Could not record site preview request"));
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    shareId: share.shareId,
    mode: share.mode,
    project: {
      token: project.token,
      name: project.name,
      template: project.template,
      files: project.files,
      dependencies: project.dependencies || {},
      updatedAt: project.updatedAt,
    },
  });
};

export default handler;
