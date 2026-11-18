import { parseSkillFrontmatter, skillDescription } from "./frontmatter";
import type { RuntimeSkill, SkillEntry } from "./registry";

type ProjectFileMap = Record<string, { code?: string }>;

const toPosix = (input: string) => input.replace(/\\/g, "/");

const safeName = (input: string) =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "skill";

export const collectProjectRuntimeSkills = (
  files: ProjectFileMap,
  sourceLabel = "project"
): {
  entries: SkillEntry[];
  skills: RuntimeSkill[];
  duplicateNames: Record<string, string[]>;
} => {
  const entries: SkillEntry[] = [];
  const skills: RuntimeSkill[] = [];
  const duplicateNames: Record<string, string[]> = {};

  const skillFiles = Object.entries(files || {}).filter(([filePath]) => {
    const normalized = toPosix(filePath || "").replace(/^\/+/, "");
    return (
      /^skills\/[^/]+\/SKILL\.md$/i.test(normalized) ||
      /^\.?aistudio\/skills\/[^/]+\/SKILL\.md$/i.test(normalized)
    );
  });

  for (const [filePath, file] of skillFiles) {
    const markdown = typeof file?.code === "string" ? file.code : "";
    const location = toPosix(filePath.startsWith("/") ? filePath : `/${filePath}`);
    const baseDir = location.replace(/\/SKILL\.md$/i, "");
    const folderName = (baseDir.split("/").filter(Boolean).pop() || "").trim();
    const frontmatter = parseSkillFrontmatter(markdown);
    const name = (frontmatter.name || folderName || "skill").trim();

    const issues =
      markdown.trim().length === 0
        ? [
            {
              code: "empty_skill_file",
              message: "SKILL.md 内容为空",
              location,
              name,
            },
          ]
        : [];

    entries.push({
      name,
      description: skillDescription(markdown, frontmatter),
      location: `${sourceLabel}:${location}`,
      relativeLocation: location,
      isLoadable: issues.length === 0,
      issues,
    });

    if (issues.length === 0) {
      skills.push({
        name,
        description: skillDescription(markdown, frontmatter),
        license: frontmatter.license || undefined,
        compatibility: frontmatter.compatibility || undefined,
        metadata: frontmatter.metadata,
        location: `${sourceLabel}:${location}`,
        relativeLocation: location,
        baseDir: `${sourceLabel}:${baseDir}`,
        body: markdown,
      });
    }
  }

  const nameMap = new Map<string, string[]>();
  for (const skill of skills) {
    const key = safeName(skill.name);
    const list = nameMap.get(key) || [];
    list.push(skill.location);
    nameMap.set(key, list);
  }
  for (const [key, locations] of nameMap) {
    if (locations.length > 1) duplicateNames[key] = locations;
  }

  return {
    entries: entries.sort((a, b) => a.location.localeCompare(b.location)),
    skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    duplicateNames,
  };
};
