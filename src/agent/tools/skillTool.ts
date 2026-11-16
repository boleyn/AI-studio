import { registry } from "./registry";
import type { Sandbox } from "../sandbox";

export type SkillSummary = {
  name: string;
  description: string;
  path: string;
};

const SKILL_ROOTS = ["/skills", "/.aistudio/skills"];

const parseFrontmatter = (markdown: string): { name?: string; description?: string } => {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const meta: { name?: string; description?: string } = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key === "name" && val) meta.name = val;
    if (key === "description" && val) meta.description = val;
  }
  return meta;
};

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
        const meta = parseFrontmatter(text);
        const name = meta.name || entry.name;
        byName.set(name, {
          name,
          description: meta.description || "",
          path: skillFile,
        });
      } catch {
        // 目录下没有 SKILL.md 时跳过
      }
    }
  }
  return [...byName.values()];
};

registry.register<{ skill: string; args?: string }>({
  name: "Skill",
  toolset: "skills",
  readOnly: true,
  description:
    "Load a skill's full instructions (SKILL.md) from /skills or /.aistudio/skills by name. " +
    "Pass skill='list' to inspect all available skills.",
  parameters: {
    type: "object",
    properties: {
      skill: { type: "string", description: "Skill name to load, or 'list' to list available skills" },
      args: { type: "string", description: "Optional arguments for the skill" },
    },
    required: ["skill"],
  },
  async handler(input, { sandbox }) {
    const requested = String(input.skill || "").trim();
    const skills = await discoverWorkspaceSkills(sandbox);
    if (!requested || requested.toLowerCase() === "list") {
      if (skills.length === 0) return { content: "No skills installed in /skills or /.aistudio/skills." };
      return {
        content: skills.map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ""} (${s.path})`).join("\n"),
      };
    }

    const normalized = requested.toLowerCase().replace(/^\/+/, "");
    const matched = skills.find(
      (s) => s.name.toLowerCase() === normalized || s.path.toLowerCase().includes(`/${normalized}/skill.md`),
    );
    if (!matched) {
      const available = skills.map((s) => s.name).join(", ") || "(none)";
      return { content: `Skill "${requested}" not found. Available: ${available}`, isError: true };
    }

    const content = await sandbox.fs.readText(matched.path);
    const argsLine = input.args ? `\n\n[Skill Arguments]\n${String(input.args)}` : "";
    return { content: `# Skill: ${matched.name} (${matched.path})\n\n${content}${argsLine}` };
  },
});
