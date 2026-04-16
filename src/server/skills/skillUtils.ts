// @ts-nocheck
// @ts-nocheck
import yaml from "js-yaml";
import { SkillSourceType } from "@/types/skill";

export const DEFAULT_DESCRIPTION = "Describe what this skill does and when to use it.";
export const SKILLS_ROOT = "/skills";
export const SKILL_FILE_PATTERN = /^\/skills\/[^/]+\/SKILL\.md$/i;

export const toKebab = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "new-skill";

export const readFrontmatter = (content: string) => {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) return {} as { name?: string; description?: string };
  const match = trimmed.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return {} as { name?: string; description?: string };
  try {
    const parsed = yaml.load(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {} as { name?: string; description?: string };
    }
    const data = parsed as Record<string, unknown>;
    return {
      name: typeof data.name === "string" ? data.name.trim() : undefined,
      description: typeof data.description === "string" ? data.description.trim() : undefined,
    };
  } catch {
    return {} as { name?: string; description?: string };
  }
};

export const writeFrontmatter = (
  content: string,
  data: { name?: string; description?: string }
) => {
  const trimmed = content.trimStart();
  let head = "";
  let body = content;

  const yamlOptions = { indent: 2, lineWidth: -1, noRefs: true };

  if (trimmed.startsWith("---")) {
    const match = trimmed.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (match) {
      head = match[1];
      body = trimmed.slice(match[0].length);
    }
  }

  try {
    const parsed = (head ? yaml.load(head) : {}) as Record<string, any>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      const nextHead = yaml.dump(data, yamlOptions).trim();
      return `---\n${nextHead}\n---\n\n${content.trimStart()}`;
    }

    if (data.name) parsed.name = data.name;
    if (data.description) parsed.description = data.description;

    const nextHead = yaml.dump(parsed, yamlOptions).trim();
    return `---\n${nextHead}\n---\n\n${body.trimStart()}`;
  } catch {
    const nextHead = yaml.dump(data, yamlOptions).trim();
    return `---\n${nextHead}\n---\n\n${content.trimStart()}`;
  }
};

export const buildDefaultContent = (name: string, description: string, body?: string) => {
  const safeName = toKebab(name);
  const safeDescription = (description || DEFAULT_DESCRIPTION).trim();
  const safeBody =
    body?.trim() ||
    [
      "# Skill",
      "",
      "## Goal",
      "Describe what this skill should help accomplish.",
      "",
      "## Workflow",
      "1. Read context before action.",
      "2. Keep changes scoped.",
      "3. Validate before finishing.",
    ].join("\n");

  return [
    "---",
    `name: ${safeName}`,
    `description: ${safeDescription}`,
    "---",
    "",
    safeBody,
  ].join("\n");
};

export const ensureUserId = (userId: string) => {
  if (!userId?.trim()) throw new Error("用户身份无效");
  return userId.trim();
};

export const ensureName = (name?: string) => {
  const base = (name || "new-skill").trim();
  return toKebab(base);
};

export const ensureDescription = (description?: string) => {
  const text = (description || DEFAULT_DESCRIPTION).trim();
  if (!text) return DEFAULT_DESCRIPTION;
  if (text.length > 1024) return text.slice(0, 1024);
  return text;
};

export const normalizeSkillPath = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.includes("\\") || withSlash.includes("\0") || withSlash.includes("..")) {
    return null;
  }
  if (!withSlash.startsWith(SKILLS_ROOT)) {
    return null;
  }
  return withSlash;
};

export const normalizeSkillFiles = (files: unknown): Record<string, { code: string }> => {
  if (!files || typeof files !== "object" || Array.isArray(files)) return {};
  const next: Record<string, { code: string }> = {};
  Object.entries(files as Record<string, unknown>).forEach(([path, value]) => {
    const normalizedPath = normalizeSkillPath(path);
    if (!normalizedPath) return;
    const code =
      value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string"
        ? (value as { code: string }).code
        : typeof value === "string"
          ? value
          : "";
    next[normalizedPath] = { code };
  });
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
};

export const buildFilesFromContent = (name: string, content: string): Record<string, { code: string }> => ({
  [`/skills/${name}/SKILL.md`]: { code: content },
});

export const findSkillFilePath = (
  files: Record<string, { code: string }>,
  preferredName?: string
) => {
  if (preferredName) {
    const preferredPath = `/skills/${preferredName}/SKILL.md`;
    if (files[preferredPath]) return preferredPath;
  }
  return Object.keys(files).find((path) => SKILL_FILE_PATTERN.test(path));
};
