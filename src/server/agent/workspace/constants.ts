import path from "path";

export const WORKSPACE_ROOT = path.join(process.cwd(), ".aistudio", "projects");

export const MAX_WORKSPACE_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_SINGLE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SESSIONS_PER_PROJECT = 8;
export const SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export const BINARY_EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
};
