import type { NextApiRequest, NextApiResponse } from "next";

import { requireAuth } from "@server/auth/session";
import { getProject } from "@server/projects/projectStorage";
import { createShareLink, type ShareMode } from "@server/shares/shareStorage";

type CreateShareBody = {
  token?: string;
  mode?: ShareMode;
};

const isShareMode = (value: unknown): value is ShareMode => {
  return value === "editable" || value === "preview";
};

const buildShareUrl = (req: NextApiRequest, mode: ShareMode, shareId: string) => {
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  const host = req.headers.host || "localhost:3000";
  const path = mode === "editable" ? `/share/edit/${shareId}` : `/share/preview/${shareId}`;
  return `${proto}://${host}${path}`;
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const body = (req.body || {}) as CreateShareBody;
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const mode = body.mode;

  if (!token) {
    res.status(400).json({ error: "缺少项目 token" });
    return;
  }
  if (!isShareMode(mode)) {
    res.status(400).json({ error: "无效的分享模式" });
    return;
  }

  const project = await getProject(token);
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }

  const userId = String(auth.user._id);
  if (project.userId !== userId) {
    res.status(403).json({ error: "无权分享该项目" });
    return;
  }

  try {
    const link = await createShareLink({
      projectToken: token,
      mode,
      ownerUserId: userId,
    });
    res.status(201).json({
      shareId: link.shareId,
      mode: link.mode,
      url: buildShareUrl(req, mode, link.shareId),
    });
  } catch (error) {
    console.error("Failed to create share link:", error);
    res.status(500).json({ error: "创建分享链接失败" });
  }
};

export default handler;
