import path from "path";
import { getCwd } from "../utils/cwd.js";
import { maskVirtualPathForDisplay } from "../utils/file.js";
import { getFsImplementation } from "../utils/fsOperations.js";

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
const virtualizePath = (input: string) => toPosix(maskVirtualPathForDisplay(path.resolve(input)));
const getProjectSkillsRoot = () => path.join(getCwd(), ".claude", "skills");
const toRootRelativeSkillPath = (input: string, projectSkillsRoot: string) => {
  const relativePath = toPosix(path.relative(projectSkillsRoot, path.resolve(input)));
  if (!relativePath || relativePath === ".") return "/";
  if (relativePath.startsWith("..")) return `/${toPosix(path.basename(input))}`;
  return `/${relativePath}`;
};
const toSkillDisplayPath = (input: string, projectSkillsRoot: string) => {
  const virtualized = virtualizePath(input);
  if (virtualized.includes("<virtual-project-root>")) return virtualized;
  return toRootRelativeSkillPath(input, projectSkillsRoot);
};

const sanitizeSkillName = (input: string) =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled-skill";

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
  projectSkillsRoot: string,
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
    location: toSkillDisplayPath(skillFile, projectSkillsRoot),
    relativeLocation: toRootRelativeSkillPath(skillFile, projectSkillsRoot),
    baseDir: toSkillDisplayPath(skillDir, projectSkillsRoot),
    baseDirFsPath: toPosix(skillDir),
    body: markdown,
  };
};

const safeReadFile = async (target: string): Promise<string | null> => {
  try {
    return await getFsImplementation().readFile(target, { encoding: "utf8" });
  } catch {
    return null;
  }
};

const scanProjectSkills = async (): Promise<SkillSnapshot> => {
  const fs = getFsImplementation();
  const projectSkillsRoot = getProjectSkillsRoot();
  const scannedAt = Date.now();
  const entries: SkillEntry[] = [];
  const skills: RuntimeSkill[] = [];
  const duplicateNames: Record<string, string[]> = {};

  let dirEntries: string[] = [];
  try {
    const listed = await fs.readdir(projectSkillsRoot);
    dirEntries = listed
      .filter(item => item.isDirectory() || item.isSymbolicLink())
      .map(item => item.name);
  } catch {
    return {
      scannedAt,
      rootDir: toSkillDisplayPath(projectSkillsRoot, projectSkillsRoot),
      entries,
      skills,
      duplicateNames,
    };
  }

  for (const item of dirEntries) {
    const skillDir = path.join(projectSkillsRoot, item);
    const skillFile = path.join(skillDir, "SKILL.md");
    const markdown = await safeReadFile(skillFile);
    if (markdown == null) {
      entries.push({
        name: item,
        description: "",
        location: toSkillDisplayPath(skillFile, projectSkillsRoot),
        relativeLocation: toRootRelativeSkillPath(skillFile, projectSkillsRoot),
        isLoadable: false,
        issues: [
          {
            code: "missing_skill_file",
            message: "SKILL.md 不存在",
            location: toSkillDisplayPath(skillFile, projectSkillsRoot),
            name: item,
          },
        ],
      });
      continue;
    }

    const skill = buildRuntimeSkill(skillFile, markdown, projectSkillsRoot);
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
    rootDir: toSkillDisplayPath(projectSkillsRoot, projectSkillsRoot),
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
  const fs = getFsImplementation();
  const projectSkillsRoot = getProjectSkillsRoot();
  const listBaseDir = skill.baseDirFsPath || skill.baseDir;
  const boundedLimit = Math.max(1, Math.min(limit, 30));
  const files: string[] = [];
  try {
    const entries = await fs.readdir(listBaseDir);
    for (const entry of entries) {
      if (entry.isFile()) {
        files.push(toSkillDisplayPath(path.join(listBaseDir, entry.name), projectSkillsRoot));
      }
      if (files.length >= boundedLimit) break;
    }
  } catch {
    // ignore
  }
  if (files.length === 0) files.push(skill.location);
  return files.slice(0, boundedLimit);
};

export const createProjectSkill = async (input: {
  name: string;
  description: string;
  body?: string;
  compatibility?: string;
  license?: string;
}) => {
  const fs = getFsImplementation();
  const projectSkillsRoot = getProjectSkillsRoot();
  const skillName = sanitizeSkillName(input.name || "skill");
  const skillDir = path.join(projectSkillsRoot, skillName);
  const skillFile = path.join(skillDir, "SKILL.md");
  await fs.mkdir(skillDir, { recursive: true });

  const frontmatter = [
    "---",
    `name: ${skillName}`,
    `description: ${(input.description || "New skill").trim() || "New skill"}`,
    ...(input.compatibility ? [`compatibility: ${input.compatibility.trim()}`] : []),
    ...(input.license ? [`license: ${input.license.trim()}`] : []),
    "---",
    "",
  ];
  const body =
    typeof input.body === "string" && input.body.trim()
      ? input.body
      : `# ${skillName}\n\n${(input.description || "New skill").trim() || "New skill"}\n`;
  await fs.writeFile(skillFile, `${frontmatter.join("\n")}${body}\n`, "utf8");
  await reloadSkillSnapshot();

  return {
    name: skillName,
    skillDir: toSkillDisplayPath(skillDir, projectSkillsRoot),
    skillFile: toSkillDisplayPath(skillFile, projectSkillsRoot),
  };
};

export const installBuiltinSkillCreator = async () => {
  const fs = getFsImplementation();
  const projectSkillsRoot = getProjectSkillsRoot();
  const targetDir = path.join(projectSkillsRoot, "skill-creator");
  const targetFile = path.join(targetDir, "SKILL.md");

  try {
    await fs.stat(targetFile);
    return {
      installed: false,
      alreadyExists: true,
      skillDir: toSkillDisplayPath(targetDir, projectSkillsRoot),
      skillFile: toSkillDisplayPath(targetFile, projectSkillsRoot),
    };
  } catch {
    // continue
  }

  await fs.mkdir(targetDir, { recursive: true });
  const content = [
    "---",
    "name: skill-creator",
    "description: Scaffold or improve a skill with clear frontmatter and examples.",
    "compatibility: aistudio",
    "license: MIT",
    "---",
    "",
    "# skill-creator",
    "",
    "Create or update a skill in `.claude/skills/<name>/SKILL.md` with:",
    "",
    "- concise description",
    "- when_to_use",
    "- clear steps and examples",
    "",
  ].join("\n");
  await fs.writeFile(targetFile, content, "utf8");
  await reloadSkillSnapshot();
  return {
    installed: true,
    alreadyExists: false,
    skillDir: toSkillDisplayPath(targetDir, projectSkillsRoot),
    skillFile: toSkillDisplayPath(targetFile, projectSkillsRoot),
    sourceFile: "builtin:skill-creator",
  };
};
