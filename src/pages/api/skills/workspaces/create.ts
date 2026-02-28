import { createSkillWorkspace } from "@server/skills/workspaceStorage";
import { requireAuth } from "@server/auth/session";
import { getProject } from "@server/projects/projectStorage";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const userId = auth.user._id != null ? String(auth.user._id) : "";
  if (!userId) {
    res.status(401).json({ error: "用户身份无效" });
    return;
  }
  const projectToken =
    typeof req.body?.projectToken === "string" ? req.body.projectToken.trim() : "";
  if (!projectToken) {
    res.status(400).json({ error: "缺少 projectToken" });
    return;
  }

  const project = await getProject(projectToken);
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }
  if (project.userId !== userId) {
    res.status(403).json({ error: "无权访问该项目" });
    return;
  }

  try {
    const workspace = await createSkillWorkspace(userId, projectToken);
    res.status(200).json({
      workspaceId: workspace.id,
      projectToken: workspace.projectToken,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      files: workspace.files,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建 workspace 失败";
    res.status(500).json({ error: message });
  }
}
