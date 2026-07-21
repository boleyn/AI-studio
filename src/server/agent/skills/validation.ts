import { getSkillSnapshot, type SkillIssue } from "./registry";

export const validateSkills = async (targetName?: string) => {
  const snapshot = await getSkillSnapshot(false);
  const normalizedTarget = (targetName || "").trim().toLowerCase();
  const filtered = normalizedTarget
    ? snapshot.entries.filter((entry) => (entry.name || "").trim().toLowerCase() === normalizedTarget)
    : snapshot.entries;

  const issues: SkillIssue[] = [];
  for (const entry of filtered) {
    for (const issue of entry.issues) issues.push(issue);
  }

  return {
    ok: issues.length === 0,
    scannedAt: new Date(snapshot.scannedAt).toISOString(),
    skills: filtered.map((entry) => ({
      name: entry.name,
      location: entry.location,
      relativeLocation: entry.relativeLocation,
      isLoadable: entry.isLoadable,
      issues: entry.issues,
    })),
    issues,
  };
};
