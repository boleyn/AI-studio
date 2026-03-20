import type { NextApiRequest, NextApiResponse } from "next";

import { requireAuth } from "@server/auth/session";
import { deleteUserSkill, getUserSkill, updateUserSkill } from "@server/skills/skillStorage";

type UpdateSkillBody = {
  name?: string;
  description?: string;
  content?: string;
};

const getSkillId = (req: NextApiRequest) => {
  const raw = req.query.id;
  if (Array.isArray(raw)) return (raw[0] || "").trim();
  return typeof raw === "string" ? raw.trim() : "";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const userId = auth.user._id != null ? String(auth.user._id) : "";
  if (!userId) {
    res.status(401).json({ error: "用户身份无效" });
    return;
  }

  const id = getSkillId(req);
  if (!id) {
    res.status(400).json({ error: "缺少 skill id" });
    return;
  }

  if (req.method === "GET") {
    const skill = await getUserSkill({ token: id, userId });
    if (!skill) {
      res.status(404).json({ error: "skill 不存在" });
      return;
    }
    res.status(200).json({ skill });
    return;
  }

  if (req.method === "PATCH") {
    const body = (req.body || {}) as UpdateSkillBody;
    try {
      const skill = await updateUserSkill({
        token: id,
        userId,
        updates: {
          name: typeof body.name === "string" ? body.name : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          content: typeof body.content === "string" ? body.content : undefined,
        },
      });
      if (!skill) {
        res.status(404).json({ error: "skill 不存在" });
        return;
      }
      res.status(200).json({ skill });
    } catch (error) {
      const message = error instanceof Error ? error.message : "更新失败";
      res.status(400).json({ error: message });
    }
    return;
  }

  if (req.method === "DELETE") {
    const ok = await deleteUserSkill({ token: id, userId });
    if (!ok) {
      res.status(404).json({ error: "skill 不存在" });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.setHeader("Allow", ["GET", "PATCH", "DELETE"]);
  res.status(405).json({ error: `方法 ${req.method} 不被允许` });
}
