import type { NextApiRequest, NextApiResponse } from "next";

import { getProject } from "@server/projects/projectStorage";
import { getShareLink } from "@server/shares/shareStorage";

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

  const project = await getProject(share.projectToken);
  if (!project) {
    res.status(404).json({ error: "来源项目不存在" });
    return;
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
