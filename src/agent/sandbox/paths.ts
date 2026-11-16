import path from "node:path";

/** 把任意输入规整为以 / 开头的虚拟路径（posix 风格），并消除 `..` 越界。 */
export const normalizeVirtualPath = (input: string): string => {
  const raw = (input || "").replace(/\\/g, "/").trim();
  const normalized = path.posix.normalize(raw.startsWith("/") ? raw : `/${raw}`);
  // path.posix.normalize("/../a") => "/a"，天然不会越过根
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : "/";
};

/** 虚拟路径 → 宿主机绝对路径（保证位于 root 之内）。 */
export const resolveInsideRoot = (root: string, virtualPath: string): string => {
  const normalizedRoot = path.resolve(root);
  const relative = normalizeVirtualPath(virtualPath).slice(1);
  const resolved = path.resolve(normalizedRoot, relative);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Path escapes sandbox workspace: ${virtualPath}`);
  }
  return resolved;
};

/** 宿主机绝对路径 → 虚拟路径 */
export const toVirtualPath = (root: string, absolutePath: string): string => {
  const rel = path.relative(path.resolve(root), path.resolve(absolutePath)).replace(/\\/g, "/");
  if (!rel) return "/";
  if (rel.startsWith("..")) return absolutePath;
  return `/${rel}`;
};

/** 把文本中出现的宿主机根目录替换为 `/`，避免向模型/用户泄露服务器路径。 */
export const maskHostPaths = (text: string, root: string): string => {
  if (!text) return text;
  const normalizedRoot = path.resolve(root);
  return text.split(`${normalizedRoot}/`).join("/").split(normalizedRoot).join("/");
};

/** 生成安全的目录名片段 */
export const toSafeSegment = (raw: string): string => {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "default";
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "default";
};

/**
 * 运行时挂载目录（不属于用户项目产物，不导出到编辑器）：
 * /skills 是仓库内置 skills，/workspace 是旧版 cwd 适配遗留。
 */
export const isExportableProjectPath = (virtualPath: string): boolean => {
  const segments = normalizeVirtualPath(virtualPath).split("/").filter(Boolean);
  const top = segments[0]?.toLowerCase();
  if (top === "skills" || top === "workspace") return false;
  if (segments.some((segment) => segment.startsWith("."))) return false;
  return true;
};

export const isLikelyBinary = (buffer: Buffer): boolean => {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  for (const byte of sample) if (byte === 0) return true;
  return false;
};

export const encodeProjectFile = (buffer: Buffer): string => {
  const text = buffer.toString("utf8");
  if (!isLikelyBinary(buffer) && Buffer.from(text, "utf8").equals(buffer)) return text;
  return `data:application/octet-stream;base64,${buffer.toString("base64")}`;
};
