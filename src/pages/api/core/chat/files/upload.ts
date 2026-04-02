import path from "node:path";
import { createHash } from "node:crypto";
import { requireAuth } from "@server/auth/session";
import { getProject, type ProjectFile, updateBinaryFile } from "@server/projects/projectStorage";
import { buildChatFileViewUrl, deleteStorageObjects, getObjectFromStorage } from "@server/storage/s3";
import type { NextApiRequest, NextApiResponse } from "next";

import {
  assertChatScopedStoragePath,
  MAX_FILES,
  MAX_FILE_SIZE,
  toSafeFileName,
} from "./shared";
import { pendingParseInfo, type UploadFileResult } from "./types";

interface UploadFileInput {
  id?: string;
  name: string;
  type?: string;
  size?: number;
  lastModified?: number;
  storagePath: string;
}

const inferContentTypeFromName = (fileName: string) => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "application/octet-stream";
};
const buildMirrorRawFilePath = ({
  storagePath,
}: {
  storagePath: string;
}) => {
  const base = toSafeFileName(path.posix.basename(storagePath));
  return `/.files/${base}`;
};

const toMd5 = (value: Buffer | Uint8Array) =>
  createHash("md5")
    .update(Buffer.isBuffer(value) ? value : Buffer.from(value))
    .digest("hex");

const toProjectFileBuffer = (file: ProjectFile): Buffer => {
  const code = typeof file?.code === "string" ? file.code : "";
  const trimmed = code.trim();
  if (trimmed.startsWith("data:")) {
    const commaIndex = trimmed.indexOf(",");
    if (commaIndex > 0) {
      const header = trimmed.slice(0, commaIndex).toLowerCase();
      if (header.includes(";base64")) {
        try {
          return Buffer.from(trimmed.slice(commaIndex + 1), "base64");
        } catch {
          // fallback to plain text buffer
        }
      }
    }
  }
  return Buffer.from(code, "utf8");
};

const collectExistingAttachmentMd5 = async (token: string) => {
  const project = await getProject(token);
  const md5Set = new Set<string>();
  if (!project?.files || typeof project.files !== "object") {
    return md5Set;
  }

  for (const [projectPath, projectFile] of Object.entries(project.files)) {
    if (!projectPath.startsWith("/.files/")) continue;
    md5Set.add(toMd5(toProjectFileBuffer(projectFile)));
  }

  return md5Set;
};

const syncAttachmentRawToProject = async ({
  token,
  file,
  storagePath,
  buffer,
}: {
  token: string;
  file: UploadFileInput;
  storagePath: string;
  buffer: Buffer;
}) => {
  const mirrorPath = buildMirrorRawFilePath({
    storagePath,
  });
  const normalizedType = (file.type || "").trim().toLowerCase();
  const type =
    normalizedType && normalizedType !== "application/octet-stream"
      ? normalizedType
      : inferContentTypeFromName(file.name || storagePath);
  await updateBinaryFile(token, mirrorPath, buffer, type);
};

const getToken = (req: NextApiRequest): string | null =>
  typeof req.body?.token === "string" ? req.body.token : null;

const getChatId = (req: NextApiRequest): string | null =>
  typeof req.body?.chatId === "string" ? req.body.chatId : null;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ files: UploadFileResult[] } | { error: string }>
) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const token = getToken(req);
  const chatId = getChatId(req);
  if (!token || !chatId) {
    res.status(400).json({ error: "缺少 token 或 chatId 参数" });
    return;
  }

  const files = Array.isArray(req.body?.files) ? (req.body.files as UploadFileInput[]) : [];
  if (files.length === 0) {
    res.status(400).json({ error: "缺少 files 参数" });
    return;
  }
  if (files.length > MAX_FILES) {
    res.status(400).json({ error: `单次最多上传 ${MAX_FILES} 个文件` });
    return;
  }

  const now = Date.now();
  const results: UploadFileResult[] = [];
  const existingAttachmentMd5 = await collectExistingAttachmentMd5(token);
  const uploadedAttachmentMd5 = new Set<string>();

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (!file || typeof file.name !== "string" || typeof file.storagePath !== "string") {
      continue;
    }

    const size = Number.isFinite(Number(file.size)) ? Number(file.size) : 0;
    if (size > MAX_FILE_SIZE) {
      res.status(400).json({ error: `文件 ${file.name} 超过 ${MAX_FILE_SIZE / (1024 * 1024)}MB 限制` });
      return;
    }

    const type = file.type || "application/octet-stream";
    let storagePath = "";
    try {
      storagePath = assertChatScopedStoragePath({
        storagePath: file.storagePath,
        token,
        chatId,
      });
    } catch {
      res.status(400).json({ error: `文件 ${file.name} 路径非法` });
      return;
    }

    const publicUrl = buildChatFileViewUrl({
      storagePath,
      token,
      chatId,
    });

    let buffer: Buffer | null = null;
    try {
      const object = await getObjectFromStorage({
        key: storagePath,
        bucketType: "private",
      });
      buffer = object.buffer;
    } catch (error) {
      console.warn("[chat-files] read uploaded object failed", {
        fileName: file.name,
        storagePath,
        error: error instanceof Error ? error.message : String(error ?? ""),
      });
    }

    if (buffer) {
      const fileMd5 = toMd5(buffer);
      const isDuplicateInProject = existingAttachmentMd5.has(fileMd5);
      const isDuplicateInCurrentBatch = uploadedAttachmentMd5.has(fileMd5);
      if (isDuplicateInProject || isDuplicateInCurrentBatch) {
        await deleteStorageObjects({
          keys: [storagePath],
          bucketType: "private",
        }).catch(() => undefined);
        continue;
      }
      uploadedAttachmentMd5.add(fileMd5);
      existingAttachmentMd5.add(fileMd5);
    }

    results.push({
      id: typeof file.id === "string" ? file.id : undefined,
      name: file.name,
      type,
      size,
      lastModified: Number.isFinite(Number(file.lastModified)) ? Number(file.lastModified) : now,
      storagePath,
      publicUrl,
      parse: pendingParseInfo,
    });

    try {
      if (buffer) {
        await syncAttachmentRawToProject({
          token,
          file,
          storagePath,
          buffer,
        });
      }
    } catch (error) {
      console.warn("[chat-files] sync attachment raw to project failed", {
        fileName: file.name,
        storagePath,
        error: error instanceof Error ? error.message : String(error ?? ""),
      });
    }
  }

  res.status(200).json({ files: results });
}
