import type { Sandbox } from "../sandbox";
import { parseSkillFrontmatter, skillDescription } from "./frontmatter";

export type SkillSummary = {
  name: string;
  description: string;
  path: string;
  tools?: string[];
};

const SKILL_ROOTS = ["/skills", "/.aistudio/skills"];

/** 扫描工作空间内的可用 Skills（/.aistudio/skills 覆盖 /skills 同名项） */
export const discoverWorkspaceSkills = async (sandbox: Sandbox): Promise<SkillSummary[]> => {
  const byName = new Map<string, SkillSummary>();
  for (const root of SKILL_ROOTS) {
    let entries;
    try {
      entries = await sandbox.fs.readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.type !== "directory") continue;
      const skillFile = `${entry.path}/SKILL.md`;
      try {
        const text = await sandbox.fs.readText(skillFile);
        const meta = parseSkillFrontmatter(text);
        const name = meta.name || entry.name;
        byName.set(name.toLowerCase(), {
          name,
          description: skillDescription(text, meta),
          path: skillFile,
          ...(meta.tools ? { tools: meta.tools } : {}),
        });
      } catch {
        // 目录下没有 SKILL.md 时跳过
      }
    }
  }
  return [...byName.values()];
};
