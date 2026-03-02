import {
  getSkillWorkspace,
  replaceSkillWorkspaceFiles,
  writeSkillWorkspaceFile,
} from "@server/skills/workspaceStorage";
import { requireAuth } from "@server/auth/session";
import type { NextApiRequest, NextApiResponse } from "next";

const getWorkspaceId = (req: NextApiRequest) => {
  const value = req.query.workspaceId;
  if (Array.isArray(value)) return value[0] || "";
  return typeof value === "string" ? value : "";
};
const getProjectToken = (req: NextApiRequest) => {
  const value = req.query.projectToken;
  if (Array.isArray(value)) return value[0] || "";
  return typeof value === "string" ? value : "";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "PUT") {
    res.setHeader("Allow", ["GET", "PUT"]);
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

  const workspaceId = getWorkspaceId(req).trim();
  const projectToken = getProjectToken(req).trim();
  if (!workspaceId) {
    res.status(400).json({ error: "缺少 workspaceId" });
    return;
  }

  if (req.method === "PUT") {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const bodyProjectToken = typeof body.projectToken === "string" ? body.projectToken.trim() : "";
    const nextFiles =
      body.files && typeof body.files === "object" && !Array.isArray(body.files)
        ? (body.files as Record<string, { code: string }>)
        : null;

    if (nextFiles) {
      try {
        const files = await replaceSkillWorkspaceFiles({
          workspaceId,
          userId,
          projectToken: bodyProjectToken || projectToken || undefined,
          files: nextFiles,
        });
        res.status(200).json({
          workspaceId,
          files,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "覆盖 workspace 文件失败";
        res.status(400).json({ error: message });
      }
      return;
    }

    const path = typeof body.path === "string" ? body.path.trim() : "";
    const content = typeof body.content === "string" ? body.content : "";
    if (!path) {
      res.status(400).json({ error: "缺少 path" });
      return;
    }
    try {
      const files = await writeSkillWorkspaceFile({
        workspaceId,
        userId,
        projectToken: bodyProjectToken || projectToken || undefined,
        path,
        content,
      });
      res.status(200).json({
        workspaceId,
        files,
        updatedPath: path,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存 workspace 文件失败";
      res.status(400).json({ error: message });
    }
    return;
  }

  try {
    const workspace = await getSkillWorkspace(workspaceId, userId, projectToken || undefined);
    res.status(200).json({
      workspaceId: workspace.id,
      projectToken: workspace.projectToken,
      updatedAt: workspace.updatedAt,
      files: workspace.files,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取 workspace 文件失败";
    res.status(400).json({ error: message });
  }
}
