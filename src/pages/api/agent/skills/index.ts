import { getSkillSnapshot } from "@server/agent/skills/registry";
import { collectProjectRuntimeSkills } from "@server/agent/skills/projectRuntimeSkills";
import { requireAuth } from "@server/auth/session";
import { getProject } from "@server/projects/projectStorage";
import type { NextApiRequest, NextApiResponse } from "next";

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

  const snapshot = await getSkillSnapshot(false);
  const projectTokenRaw = req.query.projectToken;
  const projectToken = Array.isArray(projectTokenRaw)
    ? (projectTokenRaw[0] || "").trim()
    : typeof projectTokenRaw === "string"
    ? projectTokenRaw.trim()
    : "";
  let projectEntries: typeof snapshot.entries = [];
  let projectSkills: typeof snapshot.skills = [];
  let projectDuplicateNames: Record<string, string[]> = {};

  if (projectToken) {
    const project = await getProject(projectToken);
    if (!project || project.userId !== userId) {
      res.status(403).json({ error: "无权访问该项目技能" });
      return;
    }
    const parsed = collectProjectRuntimeSkills(project.files || {}, `project:${projectToken}`);
    projectEntries = parsed.entries;
    projectSkills = parsed.skills;
    projectDuplicateNames = parsed.duplicateNames;
  }

  const mergedByLocation = new Map<string, (typeof snapshot.entries)[number]>();
  for (const entry of snapshot.entries) mergedByLocation.set(entry.location, entry);
  for (const entry of projectEntries) mergedByLocation.set(entry.location, entry);

  const mergedSkillByName = new Map<string, (typeof snapshot.skills)[number]>();
  for (const skill of snapshot.skills) mergedSkillByName.set(skill.name, skill);
  for (const skill of projectSkills) mergedSkillByName.set(skill.name, skill);

  const duplicateNames = {
    ...snapshot.duplicateNames,
    ...projectDuplicateNames,
  };

  const mergedEntries = [...mergedByLocation.values()].sort((a, b) => a.location.localeCompare(b.location));
  const mergedSkills = [...mergedSkillByName.values()].sort((a, b) => a.name.localeCompare(b.name));

  res.status(200).json({
    scannedAt: new Date(Date.now()).toISOString(),
    rootDir: projectToken ? `${snapshot.rootDir} + project:${projectToken}` : snapshot.rootDir,
    total: mergedEntries.length,
    loadable: mergedSkills.length,
    duplicateNames,
    skills: mergedEntries.map((entry) => ({
      name: entry.name,
      description: entry.description,
      location: entry.location,
      relativeLocation: entry.relativeLocation,
      isLoadable: entry.isLoadable,
      issues: entry.issues,
    })),
  });
}
