import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { findUserByUsername } from "@server/auth/userStore";
import { getProjectAccessState, readProjectArtifactVersion, readProjectFile } from "@server/projects/projectStorage";
import {
  createArtifactShare,
  getArtifactShare,
  readArtifactShareSnapshot,
  updateArtifactShareMember,
} from "@server/shares/artifactShareStorage";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const userId = String(auth.user._id);
  res.setHeader("Cache-Control", "private, no-store");
  const body = req.body || {};
  const id = typeof req.query.id === "string" ? req.query.id : "";

  try {
    if (req.method === "POST") {
      const token = typeof body.token === "string" ? body.token : "";
      const path = typeof body.path === "string" ? body.path : "";
      const version = typeof body.version === "string" ? body.version : "";
      if (!token || !path) return res.status(400).json({ error: "缺少工作成果" });
      if (await getProjectAccessState(token, userId) !== "ok") return res.status(404).json({ error: "工作成果不存在" });
      const source = await (version ? readProjectArtifactVersion(token, version, path) : readProjectFile(token, path))
        .catch(() => null);
      if (!source) return res.status(404).json({ error: "工作成果不存在" });
      const share = await createArtifactShare({ projectToken: token, ownerId: userId, ownerName: auth.user.username, path, bytes: source.buffer });
      if (!share) throw new Error("Share creation did not return a record");
      return res.status(201).json({ id: share._id, filename: share.filename, owner: share.ownerName, members: share.members });
    }

    if (req.method !== "GET" && req.method !== "PATCH") {
      res.setHeader("Allow", ["GET", "POST", "PATCH"]);
      return res.status(405).end();
    }
    const share = await getArtifactShare(id);
    if (!share) return res.status(404).json({ error: "共享文件不可用" });
    const owner = share.ownerId === userId;
    if ((!owner && !share.members.some((member) => member.userId === userId))
      || await getProjectAccessState(share.projectToken, share.ownerId) !== "ok") {
      return res.status(404).json({ error: "共享文件不可用" });
    }

    if (req.method === "PATCH") {
      if (!owner) return res.status(403).json({ error: "仅所有者可管理访问权限" });
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const member = body.remove === true
        ? share.members.find((item) => item.username === username)
        : username && username.length <= 100
          ? await findUserByUsername(username).then((user) => user ? { userId: String(user._id), username: user.username } : undefined)
          : undefined;
      if (!member || member.userId === userId) return res.status(400).json({ error: "请选择有效的 Hermes 账号" });
      const updated = await updateArtifactShareMember(id, userId, member, body.remove === true);
      return res.status(200).json({ members: updated?.members ?? [] });
    }

    if (req.query.file === "1") {
      const snapshot = await readArtifactShareSnapshot(id);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(share.filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`);
      return res.status(200).send(snapshot.buffer);
    }

    return res.status(200).json({ filename: share.filename, owner: share.ownerName });
  } catch (error) {
    console.error("Artifact share request failed", error);
    return res.status(500).json({ error: "暂时无法处理共享文件" });
  }
}
