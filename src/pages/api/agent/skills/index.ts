import { getSkillSnapshot } from "@server/agent/skills/registry";
import { requireAuth } from "@server/auth/session";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const snapshot = await getSkillSnapshot(false);
  res.status(200).json({
    scannedAt: new Date(snapshot.scannedAt).toISOString(),
    rootDir: snapshot.rootDir,
    total: snapshot.entries.length,
    loadable: snapshot.skills.length,
    duplicateNames: snapshot.duplicateNames,
    skills: snapshot.entries.map((entry) => ({
      name: entry.name,
      description: entry.description,
      location: entry.location,
      relativeLocation: entry.relativeLocation,
      isLoadable: entry.isLoadable,
      issues: entry.issues,
    })),
  });
}
