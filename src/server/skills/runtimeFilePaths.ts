import { toWorkspacePublicFiles } from "./workspaceStorage";

export type RuntimeSkillFiles = Record<string, { code: string }>;

export const toStoredSkillRuntimeFiles = (
  files: RuntimeSkillFiles,
  skillName: string
): RuntimeSkillFiles => {
  const safeSkillName = skillName.trim();
  if (!safeSkillName) return files;

  const publicRoot = `/${safeSkillName}/`;
  const storedRoot = `/skills/${safeSkillName}/`;
  return Object.fromEntries(
    Object.entries(files).map(([filePath, file]) => {
      if (filePath.startsWith(storedRoot)) return [filePath, file];
      if (filePath.startsWith(publicRoot)) return [`/skills${filePath}`, file];
      if (filePath === "/SKILL.md" || filePath === "/_meta.json" || filePath.startsWith("/scripts/")) {
        return [`${storedRoot}${filePath.replace(/^\/+/, "")}`, file];
      }
      return [filePath, file];
    })
  );
};

export const toPublicSkillRuntimeFiles = (files: RuntimeSkillFiles): RuntimeSkillFiles =>
  toWorkspacePublicFiles(files);
