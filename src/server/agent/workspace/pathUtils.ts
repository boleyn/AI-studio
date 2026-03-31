import path from "path";

export const toSafeSegment = (value: string) => {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return normalized || "default";
};

export const normalizeProjectPath = (input: string) => {
  const raw = (input || "").trim();
  if (!raw) throw new Error("文件路径不能为空");
  const segments = raw.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`文件路径不安全: ${input}`);
  }
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const normalized = path.posix.normalize(withSlash);
  if (!normalized.startsWith("/") || normalized.includes("\0") || normalized.includes("..")) {
    throw new Error(`文件路径不安全: ${input}`);
  }
  return normalized;
};

export const ensureInside = (baseDir: string, candidate: string, label: string) => {
  const relative = path.relative(baseDir, candidate);
  const inside =
    candidate === baseDir ||
    (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative));
  if (!inside) {
    throw new Error(`${label} 越界：仅允许访问项目工作区`);
  }
};

export const isLikelyBinaryBuffer = (buffer: Buffer) => {
  const checkLen = Math.min(buffer.length, 8000);
  for (let i = 0; i < checkLen; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
};
