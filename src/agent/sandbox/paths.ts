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
export const maskHostPaths = (text: string, root: string, replacement = "/"): string => {
  if (!text) return text;
  const normalizedRoot = path.resolve(root);
  const suffix = replacement.endsWith("/") ? replacement : `${replacement}/`;
  return text.split(`${normalizedRoot}/`).join(suffix).split(normalizedRoot).join(replacement);
};

export const CLOUD_HOST_HOME = "/home/user";

/** 将容器物理路径 (/workspace/<workspaceKey>) 虚拟化为云电脑标准路径 (/home/user)。 */
export const virtualizeCloudHostPaths = (
  text: string,
  workspaceKey: string,
  mirrorRoot?: string,
): string => {
  if (!text) return text;
  let out = text;
  if (workspaceKey) {
    const containerRoot = `/workspace/${workspaceKey}`;
    out = out.split(`${containerRoot}/`).join(`${CLOUD_HOST_HOME}/`).split(containerRoot).join(CLOUD_HOST_HOME);
  }
  if (mirrorRoot) {
    out = maskHostPaths(out, mirrorRoot, CLOUD_HOST_HOME);
  }
  return out;
};

/** 将命令中出现的云电脑路径 (/home/user) 还原为容器物理路径 (/workspace/<workspaceKey>)。 */
export const devirtualizeCloudHostPaths = (command: string, workspaceKey: string): string => {
  if (!command || !workspaceKey) return command;
  const containerRoot = `/workspace/${workspaceKey}`;
  return command.replace(/\/home\/user(?=\/|\s|['";&|)]|$)/g, containerRoot);
};

/** 生成安全的目录名片段 */
export const toSafeSegment = (raw: string): string => {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "default";
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "default";
};

/** 生成人类可读的项目文件夹名（保留中英文、数字、-、_，去除危险字符）。 */
export const toReadableProjectDir = (projectName?: string, fallbackToken?: string): string => {
  const cleaned = (projectName || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 64);
  if (cleaned && cleaned !== "." && cleaned !== "..") return cleaned;
  return toSafeSegment(fallbackToken || "default");
};

/**
 * 运行时挂载目录（不属于用户项目产物，不导出到编辑器）：
 * /skills 是仓库内置 skills，/workspace 是旧版 cwd 适配遗留。
 */
export const isExportableProjectPath = (virtualPath: string): boolean => {
  const segments = normalizeVirtualPath(virtualPath).split("/").filter(Boolean);
  const top = segments[0]?.toLowerCase();
  if (top === "skills" || top === "workspace") return false;
  if (segments.some((segment) => ["node_modules", "__pycache__"].includes(segment))) return false;
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

export function decodeDataUrlToBuffer(value: string): Buffer | null {
  const trimmed = (value || '').trim()
  const matched = trimmed.match(/^data:([^;,]+)?;base64,(.+)$/is)
  if (!matched || !matched[2]) return null
  try {
    return Buffer.from(matched[2], 'base64')
  } catch {
    return null
  }
}
