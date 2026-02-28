import type { NextApiRequest, NextApiResponse } from "next";

import { requireAuth } from "@server/auth/session";
import { generateToken, getProject, saveProject, type ProjectData } from "@server/projects/projectStorage";
import { getShareLink } from "@server/shares/shareStorage";

const buildForkedName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return "未命名项目 副本";
  return trimmed.endsWith("副本") ? trimmed : `${trimmed} 副本`;
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
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
  if (share.mode !== "editable") {
    res.status(403).json({ error: "该分享不支持可编辑复制" });
    return;
  }

  const sourceProject = await getProject(share.projectToken);
  if (!sourceProject) {
    res.status(404).json({ error: "来源项目不存在" });
    return;
  }

  const now = new Date().toISOString();
  const userId = String(auth.user._id);
  const nextToken = generateToken();

  const nextProject: ProjectData = {
    token: nextToken,
    name: buildForkedName(sourceProject.name),
    template: sourceProject.template,
    userId,
    files: sourceProject.files,
    dependencies: sourceProject.dependencies || {},
    sandpackCompileInfo: sourceProject.sandpackCompileInfo,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await saveProject(nextProject);
    res.status(201).json({
      token: nextToken,
      redirectTo: `/project/${nextToken}`,
    });
  } catch (error) {
    console.error("Failed to clone shared project:", error);
    res.status(500).json({ error: "复制项目失败" });
  }
};

export default handler;
