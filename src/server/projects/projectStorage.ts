import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { ObjectId } from "mongodb";
import type { SandpackCompileInfo } from "@shared/sandpack/compileInfo";
import { getMongoDb } from "../db/mongo";
import {
  createGetObjectPresignedUrl,
  deleteStorageObjects,
  getObjectFromStorage,
  listStorageObjectKeysByPrefix,
  uploadObjectToStorage,
} from "../storage/s3";

export type ProjectFile = {
  code: string;
};

export type ProjectMeta = {
  token: string;
  name: string;
  description?: string;
  template: string;
  userId: string;
  dependencies?: Record<string, string>;
  sandpackCompileInfo?: SandpackCompileInfo;
  createdAt: string;
  updatedAt: string;
};

export type ProjectData = {
  token: string;
  name: string;
  description?: string;
  template: string;
  userId: string;
  files: Record<string, ProjectFile>;
  dependencies?: Record<string, string>;
  sandpackCompileInfo?: SandpackCompileInfo;
  createdAt: string;
  updatedAt: string;
};

export type ProjectListItem = {
  token: string;
  name: string;
  description?: string;
  fileCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectOverviewItem = {
  token: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectDoc = {
  _id: ObjectId;
  token: string;
  name: string;
  description?: string;
  template: string;
  userId: string;
  dependencies?: Record<string, string>;
  sandpackCompileInfo?: SandpackCompileInfo;
  filesPath?: string;
  files?: Record<string, ProjectFile>;
  fileCount?: number;
  createdAt: string;
  updatedAt: string;
};

const COLLECTION = "projects";
const PROJECT_STORAGE_PREFIX = "projects";
const PROJECT_STORAGE_FILES_SEGMENT = "files";
const CHAT_UPLOAD_ROOT = "chat_uploads";
const LEGACY_PROJECT_FILES_ROOT = path.join(process.cwd(), "data", "projects");

async function getCollection() {
  const db = await getMongoDb();
  return db.collection<ProjectDoc>(COLLECTION);
}

async function ensureTokenIndex() {
  const coll = await getCollection();
  await coll.createIndex({ token: 1 }, { unique: true });
}

function getLegacyProjectDir(token: string): string {
  return path.join(LEGACY_PROJECT_FILES_ROOT, token);
}

function toSafeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

function getProjectStoragePrefix(token: string): string {
  return path.posix.join(PROJECT_STORAGE_PREFIX, token, PROJECT_STORAGE_FILES_SEGMENT);
}

function getTokenChatUploadPrefix(token: string): string {
  return `${CHAT_UPLOAD_ROOT}/${toSafeSegment(token)}`;
}

function getFilesMetaPath(token: string): string {
  return getProjectStoragePrefix(token);
}

function toProjectStorageFileKey(token: string, filePath: string): string {
  const normalizedPosix = path.posix.normalize(filePath.startsWith("/") ? filePath : `/${filePath}`);
  if (!normalizedPosix.startsWith("/")) {
    throw new Error(`非法文件路径: ${filePath}`);
  }
  const relativePosix = normalizedPosix.replace(/^\/+/, "");
  if (!relativePosix || relativePosix.startsWith("..") || relativePosix.includes("\0")) {
    throw new Error(`非法文件路径: ${filePath}`);
  }
  return path.posix.join(getProjectStoragePrefix(token), relativePosix);
}

function toProjectFilePathFromStorageKey(token: string, storageKey: string): string {
  const prefix = `${getProjectStoragePrefix(token).replace(/\/+$/, "")}/`;
  if (!storageKey.startsWith(prefix)) {
    throw new Error(`非法存储路径: ${storageKey}`);
  }
  const relative = storageKey.slice(prefix.length).trim();
  if (!relative || relative.startsWith("..") || relative.includes("\0")) {
    throw new Error(`非法存储路径: ${storageKey}`);
  }
  return `/${relative}`;
}

const isImagePath = (filePath: string) => {
  const ext = path.posix.extname(filePath).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif"].includes(ext);
};

const inferImageMimeFromPath = (filePath: string) => {
  const ext = path.posix.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".avif") return "image/avif";
  return "image/png";
};

const isLikelyTextContentType = (contentType?: string) => {
  const normalized = (contentType || "").toLowerCase().split(";")[0].trim();
  if (!normalized) return true;
  if (normalized.startsWith("text/")) return true;
  return [
    "application/json",
    "application/ld+json",
    "application/xml",
    "application/javascript",
    "application/x-javascript",
    "application/typescript",
    "application/x-typescript",
    "application/ecmascript",
    "application/x-www-form-urlencoded",
    "application/graphql",
    "application/yaml",
    "application/x-yaml",
    "application/toml",
    "image/svg+xml",
  ].includes(normalized);
};

async function syncFileToStorage(token: string, filePath: string, code: string) {
  await uploadObjectToStorage({
    key: toProjectStorageFileKey(token, filePath),
    body: code,
    contentType: "text/plain; charset=utf-8",
    bucketType: "private",
  });
}

async function syncBinaryFileToStorage(
  token: string,
  filePath: string,
  content: Buffer | Uint8Array,
  contentType?: string
) {
  const normalizedType = (contentType || "").toLowerCase();
  const resolvedContentType =
    normalizedType && normalizedType !== "application/octet-stream"
      ? normalizedType
      : isImagePath(filePath)
      ? inferImageMimeFromPath(filePath)
      : contentType || "application/octet-stream";
  await uploadObjectToStorage({
    key: toProjectStorageFileKey(token, filePath),
    body: content,
    contentType: resolvedContentType,
    bucketType: "private",
  });
}

async function syncFilesToStorage(token: string, files: Record<string, { code: string }>) {
  const dataUrlPrefix = "data:";
  const dataUrlBase64Flag = ";base64,";
  await Promise.all(
    Object.entries(files).map(async ([filePath, file]) => {
      const code = file.code ?? "";
      const trimmed = code.trim();
      if (trimmed.startsWith(dataUrlPrefix) && trimmed.includes(dataUrlBase64Flag)) {
        const commaIndex = trimmed.indexOf(",");
        const header = trimmed.slice(5, commaIndex);
        const base64Body = trimmed.slice(commaIndex + 1);
        const contentType = header.split(";")[0] || "application/octet-stream";
        try {
          const bytes = Buffer.from(base64Body, "base64");
          await syncBinaryFileToStorage(token, filePath, bytes, contentType);
          return;
        } catch {
          // fallback to plain text persistence
        }
      }
      await syncFileToStorage(token, filePath, code);
    })
  );
}

async function listProjectStorageKeys(token: string): Promise<string[]> {
  return listStorageObjectKeysByPrefix({
    prefix: getProjectStoragePrefix(token),
    bucketType: "private",
  });
}

async function countProjectStorageFiles(token: string): Promise<number> {
  const keys = await listProjectStorageKeys(token);
  return keys.length;
}

async function deleteProjectStorageFilesByKeys(keys: string[]): Promise<void> {
  await deleteStorageObjects({
    keys,
    bucketType: "private",
  });
}

async function deleteChatUploadStorageByToken(token: string): Promise<void> {
  const keys = await listStorageObjectKeysByPrefix({
    prefix: getTokenChatUploadPrefix(token),
    bucketType: "private",
  });
  await deleteProjectStorageFilesByKeys(keys);
}

async function replaceProjectFilesInStorage(
  token: string,
  files: Record<string, { code: string }>
): Promise<void> {
  const desiredKeys = new Set(
    Object.keys(files).map((filePath) => toProjectStorageFileKey(token, filePath))
  );
  const existingKeys = await listProjectStorageKeys(token);

  await syncFilesToStorage(token, files);

  const staleKeys = existingKeys.filter((key) => !desiredKeys.has(key));
  if (staleKeys.length > 0) {
    await deleteProjectStorageFilesByKeys(staleKeys);
  }
}

async function collectFilesFromStorage(token: string): Promise<Record<string, ProjectFile>> {
  const keys = await listProjectStorageKeys(token);
  if (keys.length === 0) {
    return {};
  }

  const entries = await Promise.all(
    keys.map(async (key) => {
      const filePath = toProjectFilePathFromStorageKey(token, key);
      const { buffer, contentType } = await getObjectFromStorage({
        key,
        bucketType: "private",
      });
      const type = (contentType || "").toLowerCase();
      if (type.startsWith("image/") || isImagePath(filePath)) {
        const mime = type.startsWith("image/") ? type : inferImageMimeFromPath(filePath);
        const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
        return [filePath, { code: dataUrl }] as const;
      }

      if (isLikelyTextContentType(contentType)) {
        return [filePath, { code: buffer.toString("utf8") }] as const;
      }

      const mime = (contentType || "application/octet-stream").split(";")[0].trim() || "application/octet-stream";
      const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
      return [filePath, { code: dataUrl }] as const;
    })
  );

  return Object.fromEntries(entries);
}

async function collectFilesFromLegacyDir(token: string): Promise<Record<string, ProjectFile>> {
  const dir = getLegacyProjectDir(token);
  const files: Record<string, ProjectFile> = {};

  const walk = async (currentDir: string) => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const rel = path.relative(dir, absPath).split(path.sep).join("/");
      const content = await fs.readFile(absPath, "utf8");
      files[`/${rel}`] = { code: content };
    }
  };

  try {
    await walk(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }

  return files;
}

async function cleanupLegacyDir(token: string): Promise<void> {
  await fs.rm(getLegacyProjectDir(token), { recursive: true, force: true });
}

async function migrateLegacyFilesIfNeeded(doc: ProjectDoc, coll: Awaited<ReturnType<typeof getCollection>>) {
  const legacyFiles = doc.files;
  if (!legacyFiles || Object.keys(legacyFiles).length === 0) return;

  await syncFilesToStorage(doc.token, legacyFiles);
  await coll.updateOne(
    { token: doc.token },
    {
      $set: {
        filesPath: getFilesMetaPath(doc.token),
        fileCount: Object.keys(legacyFiles).length,
        updatedAt: new Date().toISOString(),
      },
      $unset: { files: "" },
    }
  );
}

async function docToProject(doc: ProjectDoc, coll: Awaited<ReturnType<typeof getCollection>>): Promise<ProjectData> {
  await migrateLegacyFilesIfNeeded(doc, coll);
  let files = await collectFilesFromStorage(doc.token);

  if (Object.keys(files).length === 0) {
    const legacyDiskFiles = await collectFilesFromLegacyDir(doc.token);

    if (Object.keys(legacyDiskFiles).length > 0) {
      await syncFilesToStorage(doc.token, legacyDiskFiles);
      await cleanupLegacyDir(doc.token);
      await coll.updateOne(
        { token: doc.token },
        {
          $set: {
            filesPath: getFilesMetaPath(doc.token),
            fileCount: Object.keys(legacyDiskFiles).length,
            updatedAt: new Date().toISOString(),
          },
          $unset: { files: "" },
        }
      );
      files = legacyDiskFiles;
    } else {
      // 当元数据声明已有文件但对象存储为空时，通常是存储配置错误（例如 bucket 指向错误）。
      // 此时不应静默回退默认模板，否则会掩盖问题并造成“看起来成功但项目文件不对”的假象。
      const declaredFileCount =
        typeof doc.fileCount === "number" && Number.isFinite(doc.fileCount) ? Math.max(0, Math.trunc(doc.fileCount)) : 0;
      if (declaredFileCount > 0) {
        throw new Error(`项目文件缺失：token=${doc.token}, declaredFileCount=${declaredFileCount}`);
      }
      files = {};
    }
  } else {
    await cleanupLegacyDir(doc.token);
  }

  return {
    token: doc.token,
    name: doc.name,
    description: doc.description,
    template: doc.template,
    userId: doc.userId,
    files,
    dependencies: doc.dependencies ?? {},
    sandpackCompileInfo: doc.sandpackCompileInfo,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * 生成唯一的 token（用于 URL 与对话关联）
 */
export function generateToken(): string {
  return randomBytes(16).toString("hex");
}

/**
 * 根据 token 读取单个项目（元数据来自 MongoDB，文件来自对象存储）
 */
export async function getProject(token: string): Promise<ProjectData | null> {
  const coll = await getCollection();
  const doc = await coll.findOne({ token });
  return doc ? docToProject(doc, coll) : null;
}

/**
 * 检查对象存储中是否已存在项目文件
 */
export async function hasProjectFilesDir(token: string): Promise<boolean> {
  const keys = await listProjectStorageKeys(token);
  return keys.length > 0;
}

/**
 * 更新项目元数据（部分更新）
 */
export async function updateProjectMeta(
  token: string,
  updates: Partial<Pick<ProjectMeta, "name" | "description" | "template" | "dependencies" | "sandpackCompileInfo">>
): Promise<void> {
  const coll = await getCollection();
  const exists = await coll.findOne({ token }, { projection: { _id: 1 } });
  if (!exists) throw new Error("项目不存在");

  const now = new Date().toISOString();
  const set: Partial<ProjectDoc> = {
    updatedAt: now,
  };
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.description !== undefined) set.description = updates.description;
  if (updates.template !== undefined) set.template = updates.template;
  if (updates.dependencies !== undefined) set.dependencies = updates.dependencies;
  if (updates.sandpackCompileInfo !== undefined) set.sandpackCompileInfo = updates.sandpackCompileInfo;

  const result = await coll.updateOne({ token }, { $set: set });
  if (result.matchedCount === 0) throw new Error("项目不存在");
}

/**
 * 更新单个文件（仅写入对象存储）
 */
export async function updateFile(token: string, filePath: string, code: string): Promise<void> {
  const coll = await getCollection();
  const exists = await coll.findOne({ token }, { projection: { _id: 1 } });
  if (!exists) throw new Error("项目不存在");

  await syncFileToStorage(token, filePath, code);
  await cleanupLegacyDir(token);

  const now = new Date().toISOString();
  const fileCount = await countProjectStorageFiles(token);
  const result = await coll.updateOne(
    { token },
    { $set: { updatedAt: now, filesPath: getFilesMetaPath(token), fileCount }, $unset: { files: "" } }
  );
  if (result.matchedCount === 0) throw new Error("项目不存在");
}

export async function updateBinaryFile(
  token: string,
  filePath: string,
  content: Buffer | Uint8Array,
  contentType?: string
): Promise<void> {
  const coll = await getCollection();
  const exists = await coll.findOne({ token }, { projection: { _id: 1 } });
  if (!exists) throw new Error("项目不存在");

  await syncBinaryFileToStorage(token, filePath, content, contentType);
  await cleanupLegacyDir(token);

  const now = new Date().toISOString();
  const fileCount = await countProjectStorageFiles(token);
  const result = await coll.updateOne(
    { token },
    { $set: { updatedAt: now, filesPath: getFilesMetaPath(token), fileCount }, $unset: { files: "" } }
  );
  if (result.matchedCount === 0) throw new Error("项目不存在");
}

export async function deleteFile(token: string, filePath: string): Promise<void> {
  const coll = await getCollection();
  const exists = await coll.findOne({ token }, { projection: { _id: 1 } });
  if (!exists) throw new Error("项目不存在");

  const key = toProjectStorageFileKey(token, filePath);
  await deleteProjectStorageFilesByKeys([key]);
  await cleanupLegacyDir(token);

  const now = new Date().toISOString();
  const fileCount = await countProjectStorageFiles(token);
  const result = await coll.updateOne(
    { token },
    { $set: { updatedAt: now, filesPath: getFilesMetaPath(token), fileCount }, $unset: { files: "" } }
  );
  if (result.matchedCount === 0) throw new Error("项目不存在");
}

export async function readProjectFile(
  token: string,
  filePath: string
): Promise<{ buffer: Buffer; contentType?: string; contentLength?: number }> {
  const key = toProjectStorageFileKey(token, filePath);
  const object = await getObjectFromStorage({
    key,
    bucketType: "private",
  });
  return {
    buffer: object.buffer,
    contentType: object.contentType,
    contentLength: object.contentLength,
  };
}

export async function createProjectFileViewUrl(
  token: string,
  filePath: string,
  expiresIn = 900
): Promise<string> {
  const key = toProjectStorageFileKey(token, filePath);
  const { url } = await createGetObjectPresignedUrl({
    key,
    bucketType: "private",
    expiresIn,
  });
  return url;
}

/**
 * 更新多个文件（用传入 files 覆盖对象存储中的项目目录）
 */
export async function updateFiles(
  token: string,
  files: Record<string, { code: string }>
): Promise<void> {
  const coll = await getCollection();
  const exists = await coll.findOne({ token }, { projection: { _id: 1 } });
  if (!exists) throw new Error("项目不存在");

  await replaceProjectFilesInStorage(token, files);
  await cleanupLegacyDir(token);

  const now = new Date().toISOString();
  const result = await coll.updateOne(
    { token },
    {
      $set: { updatedAt: now, filesPath: getFilesMetaPath(token), fileCount: Object.keys(files).length },
      $unset: { files: "" },
    }
  );
  if (result.matchedCount === 0) throw new Error("项目不存在");
}

/**
 * 保存项目（元数据存 Mongo，文件仅存对象存储）
 */
export async function saveProject(project: ProjectData): Promise<void> {
  await ensureTokenIndex();
  await replaceProjectFilesInStorage(project.token, project.files ?? {});
  await cleanupLegacyDir(project.token);

  const coll = await getCollection();
  const doc: Omit<ProjectDoc, "_id"> = {
    token: project.token,
    name: project.name,
    description: project.description,
    template: project.template,
    userId: project.userId,
    dependencies: project.dependencies ?? {},
    sandpackCompileInfo: project.sandpackCompileInfo,
    filesPath: getFilesMetaPath(project.token),
    fileCount: Object.keys(project.files ?? {}).length,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  await coll.insertOne(doc as ProjectDoc);
}

/**
 * 获取指定用户的项目列表（从 MongoDB 按 userId 查询）
 */
export async function listProjects(userId: string): Promise<ProjectListItem[]> {
  if (!userId || typeof userId !== "string") return [];

  const coll = await getCollection();
  const docs = await coll
    .find({ userId })
    .sort({ updatedAt: -1 })
    .project({ token: 1, name: 1, description: 1, fileCount: 1, createdAt: 1, updatedAt: 1 })
    .toArray();

  const resolved = await Promise.all(
    docs.map(async (d) => {
      const hasCount = typeof d.fileCount === "number" && Number.isFinite(d.fileCount);
      if (hasCount) {
        return {
          token: d.token,
          name: d.name,
          description: d.description,
          fileCount: Math.max(0, Math.trunc(d.fileCount as number)),
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        };
      }

      const fileCount = await countProjectStorageFiles(d.token);
      void coll.updateOne({ token: d.token }, { $set: { fileCount } }).catch(() => undefined);
      return {
        token: d.token,
        name: d.name,
        description: d.description,
        fileCount,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      };
    })
  );

  return resolved;
}

/**
 * 获取指定用户的项目概览数据（含 createdAt，用于首页统计）
 */
export async function listProjectOverviewItems(userId: string): Promise<ProjectOverviewItem[]> {
  if (!userId || typeof userId !== "string") return [];

  const coll = await getCollection();
  const docs = await coll
    .find({ userId })
    .sort({ updatedAt: -1 })
    .project({ token: 1, name: 1, description: 1, createdAt: 1, updatedAt: 1 })
    .toArray();

  return docs.map((d) => ({
    token: d.token,
    name: d.name,
    description: d.description,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
}

export async function getProjectAccessState(
  token: string,
  userId: string
): Promise<"ok" | "not_found" | "forbidden"> {
  const safeToken = typeof token === "string" ? token.trim() : "";
  const safeUserId = typeof userId === "string" ? userId.trim() : "";
  if (!safeToken || !safeUserId) {
    return "forbidden";
  }

  const coll = await getCollection();
  const doc = await coll.findOne({ token: safeToken }, { projection: { userId: 1 } });
  if (!doc) {
    return "not_found";
  }
  if (doc.userId !== safeUserId) {
    return "forbidden";
  }
  return "ok";
}

/**
 * 删除项目（删除 Mongo 元数据 + 对象存储文件）
 */
export async function deleteProject(token: string): Promise<boolean> {
  const coll = await getCollection();
  const result = await coll.deleteOne({ token });
  const keys = await listProjectStorageKeys(token);
  await deleteProjectStorageFilesByKeys(keys);
  await deleteChatUploadStorageByToken(token);
  await cleanupLegacyDir(token);
  return result.deletedCount > 0;
}
