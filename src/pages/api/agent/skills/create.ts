import { createProjectSkill } from "@server/agent/skills/registry";
import { requireAuth } from "@server/auth/session";
import type { NextApiRequest, NextApiResponse } from "next";

type CreateSkillBody = {
  name?: string;
  description?: string;
  body?: string;
  compatibility?: string;
  license?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const body = (req.body || {}) as CreateSkillBody;
  try {
    const created = await createProjectSkill({
      name: String(body.name || ""),
      description: String(body.description || ""),
      body: typeof body.body === "string" ? body.body : undefined,
      compatibility:
        typeof body.compatibility === "string" ? body.compatibility : undefined,
      license: typeof body.license === "string" ? body.license : undefined,
    });

    res.status(200).json({
      ok: true,
      name: created.name,
      skillDir: created.skillDir,
      skillFile: created.skillFile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建 skill 失败";
    res.status(400).json({ error: message });
  }
}
