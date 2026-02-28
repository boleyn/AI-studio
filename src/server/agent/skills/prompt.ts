import type { RuntimeSkill } from "./types";

export const buildSkillsCatalogPrompt = (skills: RuntimeSkill[]): string => {
  if (skills.length === 0) return "";

  const body = skills.flatMap((skill) => [
    "  <skill>",
    `    <name>${skill.name}</name>`,
    `    <description>${skill.description}</description>`,
    `    <location>${skill.relativeLocation}</location>`,
    "  </skill>",
  ]);

  return [
    "Skills catalog for this project:",
    "When the task matches a skill below, first call skill_load with the exact skill name.",
    "Load only the skills needed for the current task.",
    "<available_skills>",
    ...body,
    "</available_skills>",
  ].join("\n");
};

export const buildSkillContentBlock = (
  skill: RuntimeSkill,
  sampledFiles: string[]
): string => {
  const fileBlock = sampledFiles.map((file) => `<file>${file}</file>`).join("\n");
  return [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.body.trim(),
    "",
    `Base directory for this skill: ${skill.baseDir}`,
    "Relative paths mentioned in this skill are relative to this base directory.",
    "Note: the file list below is sampled.",
    "<skill_files>",
    fileBlock,
    "</skill_files>",
    "</skill_content>",
  ].join("\n");
};
