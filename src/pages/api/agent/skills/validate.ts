import { validateSkills } from "@server/agent/skills/validation";
import { requireAuth } from "@server/auth/session";
import type { NextApiRequest, NextApiResponse } from "next";

const getTarget = (req: NextApiRequest): string | undefined => {
  const fromBody = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (fromBody) return fromBody;

  const fromQuery = req.query.name;
  if (Array.isArray(fromQuery)) return fromQuery[0]?.trim() || undefined;
  if (typeof fromQuery === "string" && fromQuery.trim()) return fromQuery.trim();
  return undefined;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const targetName = getTarget(req);
  const result = await validateSkills(targetName);
  res.status(200).json(result);
}
