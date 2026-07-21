import { requireAuth } from "@server/auth/session";
import { getSkillWorkspace, toWorkspacePublicFiles } from "@server/skills/workspaceStorage";
import JSZip from "jszip";
import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    responseLimit: false,
  },
};

const getQueryValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] || "" : typeof value === "string" ? value : "";

const safeDownloadName = (value: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/\.+$/g, "")
    .trim() || "skill";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
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

  const workspaceId = getQueryValue(req.query.workspaceId).trim();
  if (!workspaceId) {
    res.status(400).json({ error: "缺少 workspaceId" });
    return;
  }

  try {
    const workspace = await getSkillWorkspace(workspaceId, userId);
    const files = toWorkspacePublicFiles(workspace.files);
    const entries = Object.entries(files);
    if (entries.length === 0) {
      res.status(404).json({ error: "服务器上暂无可导出的 skill 文件" });
      return;
    }

    const zip = new JSZip();
    entries.forEach(([path, file]) => {
      zip.file(path.replace(/^\/+/, ""), typeof file?.code === "string" ? file.code : "");
    });
    const archive = await zip.generateAsync({ type: "nodebuffer" });
    const rootName = entries[0]?.[0]?.split("/").filter(Boolean)[0] || "skill";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${safeDownloadName(rootName)}-${timestamp}.zip`;

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", String(archive.length));
    res.status(200).send(archive);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "下载 skill 失败" });
  }
}
