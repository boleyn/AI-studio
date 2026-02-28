import path from "node:path";

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_FILES = 20;

export const toSafeSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";

export const toSafeFileName = (value: string) => {
  const base = path.basename(value || "file");
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "file";
};

export const isImageFile = (fileName: string, type?: string) => {
  if (type && type.startsWith("image/")) return true;
  const ext = path.extname(fileName).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"].includes(ext);
};
