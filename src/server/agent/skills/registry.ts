import { promises as fs } from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import {
  SKILL_NAME_PATTERN,
  type RuntimeSkill,
  type SkillEntry,
  type SkillIssue,
  type SkillSnapshot,
} from "./types";

const SKILL_FILE_NAME = "SKILL.md";
const SKILLS_DIR_NAME = "skills";
const CACHE_TTL_MS = 60 * 1000;

const cacheState = globalThis as typeof globalThis & {
  __agentSkillSnapshotCache?: {
    expiresAt: number;
    snapshot: SkillSnapshot;
  };
};

const toRelativePath = (filePath: string) => {
  const fromCwd = path.relative(process.cwd(), filePath);
  return fromCwd.startsWith("..") ? filePath : fromCwd;
};

const listSkillFiles = async (rootDir: string): Promise<string[]> => {
  const stack = [rootDir];
  const files: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const item of entries) {
      const absolute = path.join(current, item.name);
      if (item.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (item.isFile() && item.name === SKILL_FILE_NAME) {
        files.push(absolute);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
};

const parseFrontmatter = (
  raw: string,
  location: string
): {
  data?: Record<string, unknown>;
  body: string;
  issues: SkillIssue[];
} => {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    return {
      body: raw.trim(),
      issues: [
        {
          code: "frontmatter_missing",
          message: "缺少 YAML frontmatter（需以 --- 开始）。",
          location,
        },
      ],
    };
  }

  const match = trimmed.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return {
      body: raw.trim(),
      issues: [
        {
          code: "frontmatter_parse_error",
          message: "frontmatter 解析失败（未找到结束分隔符 ---）。",
          location,
        },
      ],
    };
  }

  const frontmatterText = match[1];
  const body = trimmed.slice(match[0].length).trim();

  try {
    const parsed = yaml.load(frontmatterText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        body,
        issues: [
          {
            code: "frontmatter_not_object",
            message: "frontmatter 必须是对象结构。",
            location,
          },
        ],
      };
    }
    return {
      data: parsed as Record<string, unknown>,
      body,
      issues: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知解析错误";
    return {
      body,
      issues: [
        {
          code: "frontmatter_parse_error",
          message: `frontmatter YAML 解析失败: ${message}`,
          location,
        },
      ],
    };
  }
};

const parseStringMetadata = (input: unknown): Record<string, string> | undefined => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const pairs = Object.entries(input).filter(
    (item): item is [string, string] => typeof item[0] === "string" && typeof item[1] === "string"
  );
  if (pairs.length === 0) return undefined;
  return Object.fromEntries(pairs);
};

const parseSkillFile = async (filePath: string): Promise<SkillEntry> => {
  const relativeLocation = toRelativePath(filePath);
  const baseDir = path.dirname(filePath);
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = parseFrontmatter(raw, filePath);

  const issues: SkillIssue[] = [...parsed.issues];
  const nameValue = parsed.data?.name;
  const descriptionValue = parsed.data?.description;
  const name = typeof nameValue === "string" && nameValue.trim() ? nameValue.trim() : undefined;
  const description =
    typeof descriptionValue === "string" && descriptionValue.trim()
      ? descriptionValue.trim()
      : undefined;
  const dirName = path.basename(baseDir);

  if (!name) {
    issues.push({
      code: "name_missing",
      message: "frontmatter 缺少 name 字段。",
      location: filePath,
    });
  }

  if (name && (name.length > 64 || !SKILL_NAME_PATTERN.test(name))) {
    issues.push({
      code: "name_invalid",
      message: "name 必须符合 ^[a-z0-9]+(-[a-z0-9]+)*$ 且长度 1-64。",
      location: filePath,
      name,
    });
  }

  if (name && name !== dirName) {
    issues.push({
      code: "name_dir_mismatch",
      message: `name 与目录名不一致（name=${name}, dir=${dirName}）。`,
      location: filePath,
      name,
    });
  }

  if (!description) {
    issues.push({
      code: "description_missing",
      message: "frontmatter 缺少 description 字段。",
      location: filePath,
      name,
    });
  }

  if (typeof descriptionValue !== "undefined" && typeof descriptionValue !== "string") {
    issues.push({
      code: "description_invalid",
      message: "description 必须是字符串。",
      location: filePath,
      name,
    });
  }

  if (description && description.length > 1024) {
    issues.push({
      code: "description_too_long",
      message: "description 长度不能超过 1024。",
      location: filePath,
      name,
    });
  }

  const license = typeof parsed.data?.license === "string" ? parsed.data.license : undefined;
  const compatibility =
    typeof parsed.data?.compatibility === "string" ? parsed.data.compatibility : undefined;
  const metadata = parseStringMetadata(parsed.data?.metadata);

  return {
    name,
    description,
    license,
    compatibility,
    metadata,
    location: filePath,
    relativeLocation,
    baseDir,
    body: parsed.body,
    issues,
    isLoadable: false,
  };
};

const toRuntimeSkill = (entry: SkillEntry): RuntimeSkill | null => {
  if (!entry.name || !entry.description) return null;
  if (entry.issues.length > 0) return null;
  return {
    name: entry.name,
    description: entry.description,
    license: entry.license,
    compatibility: entry.compatibility,
    metadata: entry.metadata,
    location: entry.location,
    relativeLocation: entry.relativeLocation,
    baseDir: entry.baseDir,
    body: entry.body,
  };
};

const scanSkills = async (): Promise<SkillSnapshot> => {
  const rootDir = path.join(process.cwd(), SKILLS_DIR_NAME);
  const rootExists = await fs
    .stat(rootDir)
    .then((stat) => stat.isDirectory())
    .catch(() => false);

  if (!rootExists) {
    return {
      scannedAt: Date.now(),
      rootDir,
      entries: [],
      skills: [],
      duplicateNames: {},
    };
  }

  const files = await listSkillFiles(rootDir);
  const entries = await Promise.all(
    files.map(async (filePath) => {
      try {
        return await parseSkillFile(filePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown");
        return {
          location: filePath,
          relativeLocation: toRelativePath(filePath),
          baseDir: path.dirname(filePath),
          body: "",
          issues: [
            {
              code: "frontmatter_parse_error" as const,
              message: `读取失败: ${message}`,
              location: filePath,
            },
          ],
          isLoadable: false,
        } as SkillEntry;
      }
    })
  );

  const loadableEntries = entries
    .map((entry) => ({ entry, skill: toRuntimeSkill(entry) }))
    .filter((item): item is { entry: SkillEntry; skill: RuntimeSkill } => Boolean(item.skill));

  const duplicates = new Map<string, string[]>();
  for (const { skill } of loadableEntries) {
    const list = duplicates.get(skill.name) || [];
    list.push(skill.location);
    duplicates.set(skill.name, list);
  }

  const duplicateNames = Object.fromEntries(
    [...duplicates.entries()]
      .filter((item) => item[1].length > 1)
      .map(([name, locations]) => [name, locations.sort((a, b) => a.localeCompare(b))])
  );

  for (const item of entries) {
    item.isLoadable = Boolean(toRuntimeSkill(item));
  }

  for (const [name, locations] of Object.entries(duplicateNames)) {
    for (const location of locations) {
      const match = entries.find((entry) => entry.location === location);
      if (!match) continue;
      match.issues.push({
        code: "duplicate_name",
        message: `检测到同名 skill "${name}"，默认采用最后扫描到的定义。`,
        location,
        name,
      });
    }
  }

  const skillByName = new Map<string, RuntimeSkill>();
  for (const { skill } of loadableEntries) {
    skillByName.set(skill.name, skill);
  }

  return {
    scannedAt: Date.now(),
    rootDir,
    entries,
    skills: [...skillByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    duplicateNames,
  };
};

const getCachedSnapshot = async (force = false): Promise<SkillSnapshot> => {
  const now = Date.now();
  const cached = cacheState.__agentSkillSnapshotCache;
  if (!force && cached && cached.expiresAt > now) {
    return cached.snapshot;
  }

  const snapshot = await scanSkills();
  cacheState.__agentSkillSnapshotCache = {
    snapshot,
    expiresAt: now + CACHE_TTL_MS,
  };
  return snapshot;
};

export const getSkillSnapshot = async (force = false): Promise<SkillSnapshot> => {
  return getCachedSnapshot(force);
};

export const reloadSkillSnapshot = async (): Promise<SkillSnapshot> => {
  return getCachedSnapshot(true);
};

export const getRuntimeSkills = async (): Promise<RuntimeSkill[]> => {
  const snapshot = await getCachedSnapshot(false);
  return snapshot.skills;
};

export const getRuntimeSkillByName = async (
  name: string
): Promise<{ skill: RuntimeSkill | null; available: string[] }> => {
  const snapshot = await getCachedSnapshot(false);
  const skill = snapshot.skills.find((item) => item.name === name) || null;
  const available = snapshot.skills.map((item) => item.name).sort((a, b) => a.localeCompare(b));
  return { skill, available };
};

export const sampleSkillFiles = async (skill: RuntimeSkill, limit = 10): Promise<string[]> => {
  const stack = [skill.baseDir];
  const found: string[] = [];

  while (stack.length > 0 && found.length < limit) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const item of entries) {
      if (found.length >= limit) break;
      const absolute = path.join(current, item.name);
      if (item.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!item.isFile()) continue;
      if (item.name === SKILL_FILE_NAME) continue;
      found.push(absolute);
    }
  }

  return found.sort((a, b) => a.localeCompare(b));
};

export type CreateSkillInput = {
  name: string;
  description: string;
  body?: string;
  compatibility?: string;
  license?: string;
  metadata?: Record<string, string>;
};

const assertValidSkillName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("name 不能为空");
  }
  if (trimmed.length > 64 || !SKILL_NAME_PATTERN.test(trimmed)) {
    throw new Error("name 必须符合 ^[a-z0-9]+(-[a-z0-9]+)*$ 且长度 1-64");
  }
  return trimmed;
};

const assertValidDescription = (description: string) => {
  const trimmed = description.trim();
  if (!trimmed) {
    throw new Error("description 不能为空");
  }
  if (trimmed.length > 1024) {
    throw new Error("description 长度不能超过 1024");
  }
  return trimmed;
};

const buildSkillMarkdown = (input: {
  name: string;
  description: string;
  body: string;
  compatibility?: string;
  license?: string;
  metadata?: Record<string, string>;
}) => {
  const lines = [
    "---",
    `name: ${input.name}`,
    `description: ${input.description}`,
  ];

  if (input.compatibility) lines.push(`compatibility: ${input.compatibility}`);
  if (input.license) lines.push(`license: ${input.license}`);
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    lines.push("metadata:");
    for (const [key, value] of Object.entries(input.metadata)) {
      lines.push(`  ${key}: ${value}`);
    }
  }
  lines.push("---", "", input.body.trim());
  return lines.join("\n");
};

export const createProjectSkill = async (
  input: CreateSkillInput
): Promise<{ skillDir: string; skillFile: string; name: string }> => {
  const name = assertValidSkillName(input.name);
  const description = assertValidDescription(input.description);
  const compatibility = input.compatibility?.trim() || "nextjs-ai-studio";
  const license = input.license?.trim() || undefined;
  const metadata = input.metadata;
  const body =
    input.body?.trim() ||
    [
      "# Skill",
      "",
      "## Goal",
      "",
      "Describe what this skill should help accomplish.",
      "",
      "## Workflow",
      "",
      "1. Read context before action.",
      "2. Keep changes scoped.",
      "3. Validate before finishing.",
    ].join("\n");

  const rootDir = path.join(process.cwd(), SKILLS_DIR_NAME);
  await fs.mkdir(rootDir, { recursive: true });

  const skillDir = path.join(rootDir, name);
  const exists = await fs
    .stat(skillDir)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    throw new Error(`skill "${name}" 已存在`);
  }

  await fs.mkdir(skillDir, { recursive: false });
  const skillFile = path.join(skillDir, SKILL_FILE_NAME);

  const markdown = buildSkillMarkdown({
    name,
    description,
    compatibility,
    license,
    metadata,
    body,
  });
  await fs.writeFile(skillFile, markdown, { encoding: "utf8", flag: "wx" });

  await getCachedSnapshot(true);
  return { skillDir, skillFile, name };
};

export const installBuiltinSkillCreator = async (): Promise<{
  installed: boolean;
  alreadyExists: boolean;
  skillDir: string;
  skillFile: string;
  sourceFile?: string;
}> => {
  const rootDir = path.join(process.cwd(), SKILLS_DIR_NAME);
  const skillDir = path.join(rootDir, "skill-creator");
  const skillFile = path.join(skillDir, SKILL_FILE_NAME);

  const exists = await fs
    .stat(skillFile)
    .then((stat) => stat.isFile())
    .catch(() => false);

  if (exists) {
    return {
      installed: false,
      alreadyExists: true,
      skillDir,
      skillFile,
    };
  }

  const home = os.homedir();
  const candidates = [
    path.join(home, ".codex", "skills", ".system", "skill-creator", "SKILL.md"),
    "/Users/santain/.codex/skills/.system/skill-creator/SKILL.md",
  ];

  let sourceFile: string | undefined;
  let sourceContent: string | undefined;

  for (const candidate of candidates) {
    const content = await fs.readFile(candidate, "utf8").catch(() => "");
    if (!content.trim()) continue;
    sourceFile = candidate;
    sourceContent = content;
    break;
  }

  if (!sourceContent || !sourceFile) {
    throw new Error("未找到内置 skill-creator 源文件");
  }

  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(skillFile, sourceContent, { encoding: "utf8", flag: "wx" });
  await getCachedSnapshot(true);

  return {
    installed: true,
    alreadyExists: false,
    skillDir,
    skillFile,
    sourceFile,
  };
};
