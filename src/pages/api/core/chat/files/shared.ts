import path from "node:path";
import { normalizeStorageKey } from "@server/storage/s3";

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_FILES = 20;
export const CHAT_UPLOAD_ROOT = "chat_uploads";

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
