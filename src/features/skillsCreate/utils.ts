import type { FileMap, ImportDiffStatus } from "./types";

export const SKILL_ROOT = "/";
export const RUNTIME_ENTRY_PATH = "/__skill_runtime__/index.ts";
export const RUNTIME_ENTRY_CODE = "export {};\n";
export const fallbackSkillFiles: FileMap = {};

export const diffStatusLabelMap: Record<ImportDiffStatus, string> = {
  added: "新增",
  removed: "删除",
  changed: "修改",
  same: "相同",
};

const languageByExt: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  sh: "shell",
  py: "python",
  java: "java",
  go: "go",
  rs: "rust",
};

export const isSkillPath = (path: string) => /^\/[^/]+\/.+/.test(path);
const isRuntimeSupportPath = (path: string) => /^\/__skill_runtime__(\/|$)/i.test(path);

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const normalizeDownloadName = (value: string) => {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/\.+$/g, "")
    .trim();
  return normalized || "skill";
};

export const parseConflictOwnerName = (message: string) => {
  const fromPattern = message.match(/已由\s+(.+?)\s+发布/u);
  if (fromPattern?.[1]) return fromPattern[1].trim();
  return "原作者";
};

export const getDiffLanguage = (filePath: string) => {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return languageByExt[ext] || "plaintext";
};

export const normalizeSkillFiles = (rawFiles: unknown): FileMap => {
  if (!rawFiles || typeof rawFiles !== "object") return {};

  const next: FileMap = {};
  Object.entries(rawFiles as Record<string, unknown>).forEach(([path, value]) => {
    if (!isSkillPath(path)) return;
    if (isRuntimeSupportPath(path)) return;

    if (typeof value === "string") {
      next[path] = { code: value };
      return;
    }

    if (value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string") {
      next[path] = { code: (value as { code: string }).code };
    }
  });

  return next;
};

export const isSameFileMap = (a: FileMap, b: FileMap) => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!(key in b)) return false;
    if ((a[key]?.code || "") !== (b[key]?.code || "")) return false;
  }
  return true;
};

const extractSkillRoots = (input: FileMap) =>
  Array.from(
    new Set(
      Object.keys(input)
        .map((path) => path.match(/^\/[^/]+\/SKILL\.md$/i)?.[0]?.replace(/\/SKILL\.md$/i, ""))
        .filter((v): v is string => Boolean(v))
    )
  ).sort();

export const isSameSkillRoots = (a: FileMap, b: FileMap) => {
  const aRoots = extractSkillRoots(a);
  const bRoots = extractSkillRoots(b);
  if (aRoots.length !== bRoots.length) return false;
  for (let i = 0; i < aRoots.length; i += 1) {
    if (aRoots[i] !== bRoots[i]) return false;
  }
  return true;
};
