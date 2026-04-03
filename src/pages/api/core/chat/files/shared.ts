import path from "node:path";
import { normalizeStorageKey } from "@server/storage/s3";

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_FILES = 20;
export const CHAT_UPLOAD_ROOT = "chat_uploads";

export const toSafeSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";

export const toSafeFileName = (value: string) => {
  const base = path.basename((value || "file").trim());
  const withoutControlChars = base.replace(/[\u0000-\u001f\u007f]/g, "");
  const sanitized = withoutControlChars
    .replace(/[\\/:"*?<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = sanitized.replace(/^\.+/, "").slice(0, 180);
  return normalized || "file";
};

export const isImageFile = (fileName: string, type?: string) => {
  const ext = path.extname(fileName).toLowerCase();
  if (ext) {
    return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"].includes(ext);
  }
  return Boolean(type && type.toLowerCase().startsWith("image/"));
};

export const getTokenUploadPrefix = (token: string) => `${CHAT_UPLOAD_ROOT}/${toSafeSegment(token)}`;

export const getChatUploadRoot = (token: string, chatId: string) =>
  `${getTokenUploadPrefix(token)}/${toSafeSegment(chatId)}/.files`;

export const assertChatScopedStoragePath = ({
  storagePath,
  token,
  chatId,
}: {
  storagePath: string;
  token: string;
  chatId?: string;
}) => {
  const normalizedPath = normalizeStorageKey(storagePath);
  const expectedPrefix = chatId
    ? `${getChatUploadRoot(token, chatId)}/`
    : `${getTokenUploadPrefix(token)}/`;
  if (!normalizedPath.startsWith(expectedPrefix)) {
    throw new Error("无权限访问该文件");
  }
  return normalizedPath;
};
