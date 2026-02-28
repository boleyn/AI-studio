import { reloadSkillSnapshot } from "@server/agent/skills/registry";
import { requireAuth } from "@server/auth/session";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const snapshot = await reloadSkillSnapshot();
  res.status(200).json({
    ok: true,
    scannedAt: new Date(snapshot.scannedAt).toISOString(),
    total: snapshot.entries.length,
    loadable: snapshot.skills.length,
    duplicateNames: snapshot.duplicateNames,
  });
}
