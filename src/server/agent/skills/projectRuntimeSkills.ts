import type { RuntimeSkill, SkillEntry } from "./registry";

type ProjectFileMap = Record<string, { code?: string }>;

const toPosix = (input: string) => input.replace(/\\/g, "/");

const safeName = (input: string) =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "skill";

const parseFrontmatter = (markdown: string): Record<string, string> => {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return {};
  return (match[1] || "").split(/\r?\n/).reduce<Record<string, string>>((acc, line) => {
    const idx = line.indexOf(":");
    if (idx <= 0) return acc;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key) acc[key] = value;
    return acc;
  }, {});
};

const pickDescription = (markdown: string, frontmatter: Record<string, string>) => {
  if (frontmatter.description) return frontmatter.description;
  return (
    markdown
      .replace(/^---[\s\S]*?---\s*/m, "")
      .split(/\r?\n\r?\n/)
      .map((item) => item.trim())
      .find(Boolean) || "No description"
  );
};

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

  const skillFiles = Object.entries(files || {}).filter(([filePath]) =>
    /^\/?\.?claude\/skills\/[^/]+\/SKILL\.md$/i.test(filePath)
  );

  for (const [filePath, file] of skillFiles) {
    const markdown = typeof file?.code === "string" ? file.code : "";
    const location = toPosix(filePath.startsWith("/") ? filePath : `/${filePath}`);
    const baseDir = location.replace(/\/SKILL\.md$/i, "");
    const folderName = (baseDir.split("/").filter(Boolean).pop() || "").trim();
    const frontmatter = parseFrontmatter(markdown);
    const name = (frontmatter.name || folderName || "skill").trim();
    const metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      if (["name", "description", "license", "compatibility"].includes(key)) continue;
      metadata[key] = value;
    }

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
      description: pickDescription(markdown, frontmatter),
      location: `${sourceLabel}:${location}`,
      relativeLocation: location,
      isLoadable: issues.length === 0,
      issues,
    });

    if (issues.length === 0) {
      skills.push({
        name,
        description: pickDescription(markdown, frontmatter),
        license: frontmatter.license || undefined,
        compatibility: frontmatter.compatibility || undefined,
        metadata: Object.keys(metadata).length ? metadata : undefined,
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
