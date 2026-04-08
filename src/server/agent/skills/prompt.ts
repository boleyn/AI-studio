import type { RuntimeSkill } from "./types";

export const buildSkillsCatalogPrompt = (skills: RuntimeSkill[]): string => {
  if (skills.length === 0) return "";

  const body = skills.map((skill) => `- ${skill.name}: ${skill.description}`);

  return [
    "Project skills catalog (compact):",
    "If task matches one of these, call skill_load with exact skill name before continuing.",
    ...body,
    "Only load skills needed for current task.",
  ].join("\n");
};

export const buildSkillContentBlock = (
  skill: RuntimeSkill,
  sampledFiles: string[],
  runnableScripts: string[] = [],
  resourceTree: string[] = []
): string => {
  const fileBlock = sampledFiles.map((file) => `<file>${file}</file>`).join("\n");
  const scriptBlock =
    runnableScripts.length > 0
      ? [
          "Runnable scripts for skill_run_script (use exact relative path):",
          "<skill_runnable_scripts>",
          ...runnableScripts.map((file) => `<script>${file}</script>`),
          "</skill_runnable_scripts>",
          "If you need to inspect script source, call Read with path like:",
          ...runnableScripts.map((file) => `<read_path>skills/${skill.name}/${file}</read_path>`),
        ]
      : [
          "Runnable scripts for skill_run_script (use exact relative path):",
          "<skill_runnable_scripts>",
          "<script>(none discovered)</script>",
          "</skill_runnable_scripts>",
        ];
  const treeBlock =
    resourceTree.length > 0
      ? [
          "Skill resource tree (truncated):",
          "<skill_resource_tree>",
          ...resourceTree.map((item) => `<node>${item}</node>`),
          "</skill_resource_tree>",
        ]
      : [
          "Skill resource tree (truncated):",
          "<skill_resource_tree>",
          "<node>(unavailable)</node>",
          "</skill_resource_tree>",
        ];
  return [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.body.trim(),
    "",
    `Base directory for this skill: ${skill.baseDir}`,
    "Relative paths mentioned in this skill are relative to this base directory.",
    "Important: For skill_run_script, script must be an exact value from <skill_runnable_scripts>; do not guess names.",
    ...scriptBlock,
    ...treeBlock,
    "Note: the file list below is sampled.",
    "<skill_files>",
    fileBlock,
    "</skill_files>",
    "</skill_content>",
  ].join("\n");
};
