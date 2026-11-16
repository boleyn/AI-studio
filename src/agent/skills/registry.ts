import path from "path";
import { promises as nativeFs, type Dirent } from "node:fs";

export type SkillIssue = {
  code: string;
  message: string;
  location: string;
  name?: string;
};

export type RuntimeSkill = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  location: string;
  relativeLocation: string;
  baseDir: string;
  baseDirFsPath?: string;
  body: string;
};

export type SkillEntry = {
  name?: string;
  description?: string;
  location: string;
  relativeLocation: string;
  isLoadable: boolean;
  issues: SkillIssue[];
};

export type SkillSnapshot = {
  scannedAt: number;
  rootDir: string;
  entries: SkillEntry[];
  skills: RuntimeSkill[];
  duplicateNames: Record<string, string[]>;
};

let snapshotCache: SkillSnapshot | null = null;

const toPosix = (input: string) => input.split(path.sep).join("/");
const getProjectSkillsRoot = () => path.join(process.cwd(), ".aistudio", "skills");
const getBuiltinSkillsRoot = () => path.join(process.cwd(), "skills");
type SkillSourcePrefix = "/.aistudio/skills" | "/skills";
type SkillFs = { readdir: (target: string) => Promise<Dirent[]>; readFile: (target: string, options: { encoding: "utf8" }) => Promise<string> };

// The global catalog contains bundled skills only. Project skills are read from
// the authorized project snapshot by the API, never from the host working directory.
const nativeSkillFs: SkillFs = {
  readdir: async (target) => nativeFs.readdir(target, { withFileTypes: true }) as Promise<Dirent[]>,
  readFile: async (target, options) => nativeFs.readFile(target, options.encoding),
};
const toRootRelativeSkillPath = (input: string, skillsRoot: string) => {
  const relativePath = toPosix(path.relative(skillsRoot, path.resolve(input)));
  if (!relativePath || relativePath === ".") return "/";
  if (relativePath.startsWith("..")) return `/${toPosix(path.basename(input))}`;
  return `/${relativePath}`;
};
const toSkillDisplayPath = (
  input: string,
  skillsRoot: string,
  sourcePrefix: SkillSourcePrefix = "/.aistudio/skills"
) => {
  const relative = toRootRelativeSkillPath(input, skillsRoot);
  if (relative === "/") return sourcePrefix;
  return `${sourcePrefix}${relative}`.replace(/\/{2,}/g, "/");
};

const parseFrontmatter = (markdown: string): Record<string, string> => {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return {};
  const body = match[1] || "";
  const lines = body.split(/\r?\n/);
  const parsed: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!key) continue;
    parsed[key] = value;
  }
  return parsed;
};

const pickDescription = (markdown: string, frontmatter: Record<string, string>): string => {
  if (frontmatter.description) return frontmatter.description;
  const firstParagraph = markdown
    .replace(/^---[\s\S]*?---\s*/m, "")
    .split(/\r?\n\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  return firstParagraph || "No description";
};

const buildRuntimeSkill = (
  skillFile: string,
  markdown: string,
  skillsRoot: string,
  sourcePrefix: SkillSourcePrefix
): RuntimeSkill => {
  const frontmatter = parseFrontmatter(markdown);
  const skillDir = path.dirname(skillFile);
  const folderName = path.basename(skillDir);
  const name = (frontmatter.name || folderName).trim();
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (["name", "description", "license", "compatibility"].includes(key)) continue;
    metadata[key] = value;
  }

  return {
    name,
    description: pickDescription(markdown, frontmatter),
    license: frontmatter.license || undefined,
    compatibility: frontmatter.compatibility || undefined,
    metadata: Object.keys(metadata).length ? metadata : undefined,
    location: toSkillDisplayPath(skillFile, skillsRoot, sourcePrefix),
    relativeLocation: toRootRelativeSkillPath(skillFile, skillsRoot),
    baseDir: toSkillDisplayPath(skillDir, skillsRoot, sourcePrefix),
    baseDirFsPath: toPosix(skillDir),
    body: markdown,
  };
};

const safeReadFile = async (fs: SkillFs, target: string): Promise<string | null> => {
  try {
    return await fs.readFile(target, { encoding: "utf8" });
  } catch {
    return null;
  }
};

const scanProjectSkills = async (): Promise<SkillSnapshot> => {
  const builtinSkillsRoot = getBuiltinSkillsRoot();
  const scannedAt = Date.now();
  const entries: SkillEntry[] = [];
  const skills: RuntimeSkill[] = [];
  const duplicateNames: Record<string, string[]> = {};
  const roots: Array<{ root: string; prefix: SkillSourcePrefix; fs: SkillFs }> = [
    { root: builtinSkillsRoot, prefix: "/skills", fs: nativeSkillFs },
  ];

  for (const { root, prefix, fs } of roots) {
    let dirEntries: string[] = [];
    try {
      const listed = await fs.readdir(root);
      dirEntries = listed
        .filter(item => item.isDirectory() || item.isSymbolicLink())
        .map(item => item.name);
    } catch {
      continue;
    }

    for (const item of dirEntries) {
      const skillDir = path.join(root, item);
      const skillFile = path.join(skillDir, "SKILL.md");
      const markdown = await safeReadFile(fs, skillFile);
      if (markdown == null) {
        entries.push({
          name: item,
          description: "",
          location: toSkillDisplayPath(skillFile, root, prefix),
          relativeLocation: toRootRelativeSkillPath(skillFile, root),
          isLoadable: false,
          issues: [
            {
              code: "missing_skill_file",
              message: "SKILL.md 不存在",
              location: toSkillDisplayPath(skillFile, root, prefix),
              name: item,
            },
          ],
        });
        continue;
      }

      const skill = buildRuntimeSkill(skillFile, markdown, root, prefix);
      const issues: SkillIssue[] = [];
      if (!skill.name.trim()) {
        issues.push({
          code: "invalid_name",
          message: "skill 名称不能为空",
          location: skill.location,
        });
      }

      entries.push({
        name: skill.name,
        description: skill.description,
        location: skill.location,
        relativeLocation: skill.relativeLocation,
        isLoadable: issues.length === 0,
        issues,
      });

      if (issues.length === 0) skills.push(skill);
    }
  }

  const nameToLocations = new Map<string, string[]>();
  for (const item of skills) {
    const key = item.name.trim().toLowerCase();
    const prev = nameToLocations.get(key) || [];
    prev.push(item.location);
    nameToLocations.set(key, prev);
  }
  for (const [name, locations] of nameToLocations) {
    if (locations.length > 1) duplicateNames[name] = locations;
  }

  return {
    scannedAt,
    rootDir: "/skills",
    entries: entries.sort((a, b) => a.location.localeCompare(b.location)),
    skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    duplicateNames,
  };
};

export const getSkillSnapshot = async (forceReload = false): Promise<SkillSnapshot> => {
  if (!forceReload && snapshotCache) return snapshotCache;
  snapshotCache = await scanProjectSkills();
  return snapshotCache;
};

export const reloadSkillSnapshot = async (): Promise<SkillSnapshot> =>
  getSkillSnapshot(true);

export const getRuntimeSkillByName = async (name: string) => {
  const snapshot = await getSkillSnapshot(false);
  const normalized = name.trim().toLowerCase();
  const skill = snapshot.skills.find((item) => item.name.trim().toLowerCase() === normalized);
  return {
    skill,
    available: snapshot.skills.map((item) => item.name),
  };
};

export const sampleSkillFiles = async (skill: RuntimeSkill, limit = 10): Promise<string[]> => {
  const fs = nativeSkillFs;
  const projectSkillsRoot = getProjectSkillsRoot();
  const builtinSkillsRoot = getBuiltinSkillsRoot();
  const listBaseDir = skill.baseDirFsPath || skill.baseDir;
  const boundedLimit = Math.max(1, Math.min(limit, 30));
  const files: string[] = [];
  try {
    const entries = await fs.readdir(listBaseDir);
    for (const entry of entries) {
      if (entry.isFile()) {
        const normalizedBase = toPosix(path.resolve(listBaseDir));
        const builtinRoot = toPosix(path.resolve(builtinSkillsRoot));
        const sourcePrefix: SkillSourcePrefix = normalizedBase.startsWith(builtinRoot)
          ? "/skills"
          : "/.aistudio/skills";
        const rootForDisplay =
          sourcePrefix === "/skills"
            ? builtinSkillsRoot
            : projectSkillsRoot;
        files.push(toSkillDisplayPath(path.join(listBaseDir, entry.name), rootForDisplay, sourcePrefix));
      }
      if (files.length >= boundedLimit) break;
    }
  } catch {
    // ignore
  }
  if (files.length === 0) files.push(skill.location);
  return files.slice(0, boundedLimit);
};
