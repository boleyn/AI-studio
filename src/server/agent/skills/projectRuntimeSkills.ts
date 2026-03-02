import path from "path";
import yaml from "js-yaml";
import { SKILL_NAME_PATTERN, type RuntimeSkill, type SkillEntry, type SkillIssue } from "./types";

type ProjectFileMap = Record<string, { code: string }>;

const SKILL_FILE_PATTERN = /^\/skills\/.+\/SKILL\.md$/i;

const parseFrontmatter = (
  raw: string,
  location: string
): { data?: Record<string, unknown>; body: string; issues: SkillIssue[] } => {
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
    return { data: parsed as Record<string, unknown>, body, issues: [] };
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

const toProjectSkillEntries = (files: ProjectFileMap, locationPrefix = "project"): SkillEntry[] => {
  const paths = Object.keys(files)
    .filter((filePath) => SKILL_FILE_PATTERN.test(filePath))
    .sort((a, b) => a.localeCompare(b));

  return paths.map((filePath) => {
    const raw = typeof files[filePath]?.code === "string" ? files[filePath].code : "";
    const location = `${locationPrefix}:${filePath}`;
    const parsed = parseFrontmatter(raw, location);
    const issues: SkillIssue[] = [...parsed.issues];
    const nameValue = parsed.data?.name;
    const descriptionValue = parsed.data?.description;
    const name = typeof nameValue === "string" && nameValue.trim() ? nameValue.trim() : undefined;
    const description =
      typeof descriptionValue === "string" && descriptionValue.trim()
        ? descriptionValue.trim()
        : undefined;
    const dirName = path.posix.basename(path.posix.dirname(filePath));

    if (!name) {
      issues.push({
        code: "name_missing",
        message: "frontmatter 缺少 name 字段。",
        location,
      });
    } else if (name.length > 64 || !SKILL_NAME_PATTERN.test(name)) {
      issues.push({
        code: "name_invalid",
        message: "name 必须符合 ^[a-z0-9]+(-[a-z0-9]+)*$ 且长度 1-64。",
        location,
        name,
      });
    }

    if (name && name !== dirName) {
      issues.push({
        code: "name_dir_mismatch",
        message: `name 与目录名不一致（name=${name}, dir=${dirName}）。`,
        location,
        name,
      });
    }

    if (!description) {
      issues.push({
        code: "description_missing",
        message: "frontmatter 缺少 description 字段。",
        location,
        name,
      });
    } else if (description.length > 1024) {
      issues.push({
        code: "description_too_long",
        message: "description 长度不能超过 1024。",
        location,
        name,
      });
    }

    if (typeof descriptionValue !== "undefined" && typeof descriptionValue !== "string") {
      issues.push({
        code: "description_invalid",
        message: "description 必须是字符串。",
        location,
        name,
      });
    }

    const license = typeof parsed.data?.license === "string" ? parsed.data.license : undefined;
    const compatibility =
      typeof parsed.data?.compatibility === "string" ? parsed.data.compatibility : undefined;
    const metadata = parseStringMetadata(parsed.data?.metadata);

    const entry: SkillEntry = {
      name,
      description,
      license,
      compatibility,
      metadata,
      location,
      relativeLocation: filePath,
      baseDir: path.posix.dirname(filePath),
      body: parsed.body,
      issues,
      isLoadable: false,
    };
    entry.isLoadable = Boolean(toRuntimeSkill(entry));
    return entry;
  });
};

export const collectProjectRuntimeSkills = (
  files: ProjectFileMap,
  locationPrefix = "project"
): {
  entries: SkillEntry[];
  skills: RuntimeSkill[];
  duplicateNames: Record<string, string[]>;
} => {
  const entries = toProjectSkillEntries(files, locationPrefix);
  const duplicates = new Map<string, string[]>();
  const skillByName = new Map<string, RuntimeSkill>();

  for (const entry of entries) {
    const runtime = toRuntimeSkill(entry);
    if (!runtime) continue;
    const list = duplicates.get(runtime.name) || [];
    list.push(runtime.location);
    duplicates.set(runtime.name, list);
    skillByName.set(runtime.name, runtime);
  }

  const duplicateNames = Object.fromEntries(
    [...duplicates.entries()]
      .filter((item) => item[1].length > 1)
      .map(([name, locations]) => [name, locations.sort((a, b) => a.localeCompare(b))])
  );

  return {
    entries,
    skills: [...skillByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    duplicateNames,
  };
};
