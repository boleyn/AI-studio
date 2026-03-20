import type { NextApiRequest, NextApiResponse } from "next";

import { requireAuth } from "@server/auth/session";
import {
  SKILL_TEMPLATE_KEYS,
  createUserSkill,
  listUserSkills,
} from "@server/skills/skillStorage";
import type { SkillSourceType } from "@/types/skill";

type CreateSkillBody = {
  name?: string;
  description?: string;
  content?: string;
  sourceType?: SkillSourceType;
  templateKey?: string;
  sourceSkillId?: string;
};

const getQuery = (req: NextApiRequest) => {
  const raw = req.query.q;
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

  if (req.method === "GET") {
    try {
      const skills = await listUserSkills({ userId, query: getQuery(req) });
      res.status(200).json({
        skills,
        templates: SKILL_TEMPLATE_KEYS,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "获取技能列表失败";
      res.status(500).json({ error: message });
    }
    return;
  }

  if (req.method === "POST") {
    const body = (req.body || {}) as CreateSkillBody;
    try {
      const skill = await createUserSkill({
        userId,
        name: typeof body.name === "string" ? body.name : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
        content: typeof body.content === "string" ? body.content : undefined,
        sourceType: body.sourceType,
        templateKey: typeof body.templateKey === "string" ? body.templateKey : undefined,
        sourceSkillId: typeof body.sourceSkillId === "string" ? body.sourceSkillId : undefined,
      });
      res.status(201).json({ skill });
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建技能失败";
      res.status(400).json({ error: message });
    }
    return;
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).json({ error: `方法 ${req.method} 不被允许` });
}
