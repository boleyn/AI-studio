import { getSkillSnapshot } from "./registry";
import type { SkillValidationResult } from "./types";

export const validateSkills = async (targetName?: string): Promise<SkillValidationResult> => {
  const snapshot = await getSkillSnapshot(false);
  const allItems = snapshot.entries.map((entry) => ({
    name: entry.name,
    location: entry.location,
    relativeLocation: entry.relativeLocation,
    isLoadable: entry.isLoadable,
    issues: entry.issues,
  }));

  const skills = targetName
    ? allItems.filter((item) => item.name === targetName)
    : allItems;

  const issues = skills.flatMap((item) => item.issues);
  if (targetName && skills.length === 0) {
    issues.push({
      code: "not_found",
      message: `未找到 skill: ${targetName}`,
      location: "",
      name: targetName,
    });
  }

  return {
    ok: issues.length === 0,
    scannedAt: new Date(snapshot.scannedAt).toISOString(),
    skills,
    issues,
  };
};
