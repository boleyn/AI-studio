import path from "node:path";
import { Readable } from "node:stream";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StorageBucketType = "public" | "private";

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

const STORAGE_REGION = process.env.STORAGE_REGION?.trim() || "us-east-1";
const STORAGE_ACCESS_KEY_ID = process.env.STORAGE_ACCESS_KEY_ID?.trim() || "";
const STORAGE_SECRET_ACCESS_KEY = process.env.STORAGE_SECRET_ACCESS_KEY?.trim() || "";
const STORAGE_S3_ENDPOINT = process.env.STORAGE_S3_ENDPOINT?.trim() || "";
const STORAGE_S3_FORCE_PATH_STYLE = parseBoolean(process.env.STORAGE_S3_FORCE_PATH_STYLE, true);
const STORAGE_S3_MAX_RETRIES = Number.parseInt(process.env.STORAGE_S3_MAX_RETRIES || "3", 10) || 3;
const STORAGE_PUBLIC_BUCKET = process.env.STORAGE_PUBLIC_BUCKET?.trim() || "";
const STORAGE_PRIVATE_BUCKET = process.env.STORAGE_PRIVATE_BUCKET?.trim() || "";

let s3Client: S3Client | null = null;

const getBucketName = (bucketType: StorageBucketType) => {
  const bucket = bucketType === "public" ? STORAGE_PUBLIC_BUCKET : STORAGE_PRIVATE_BUCKET;
  if (!bucket) {
    throw new Error(`未配置对象存储桶: ${bucketType}`);
  }
  return bucket;
};

export const getS3Client = () => {
  if (s3Client) return s3Client;

  if (!STORAGE_ACCESS_KEY_ID || !STORAGE_SECRET_ACCESS_KEY) {
    throw new Error("对象存储配置缺失：请检查 STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY");
  }

  s3Client = new S3Client({
    region: STORAGE_REGION,
    endpoint: STORAGE_S3_ENDPOINT || undefined,
    forcePathStyle: STORAGE_S3_FORCE_PATH_STYLE,
    maxAttempts: STORAGE_S3_MAX_RETRIES,
    credentials: {
      accessKeyId: STORAGE_ACCESS_KEY_ID,
      secretAccessKey: STORAGE_SECRET_ACCESS_KEY,
    },
  });

  return s3Client;
};

export const normalizeStorageKey = (key: string) => {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized.includes("\0")) {
    throw new Error("storagePath 非法");
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === ".." || part === ".")) {
    throw new Error("storagePath 非法");
  }

  return parts.join("/");
};

const toBuffer = async (body: unknown): Promise<Buffer> => {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);

  const anyBody = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof anyBody.transformToByteArray === "function") {
    const bytes = await anyBody.transformToByteArray();
    return Buffer.from(bytes);
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  const readableBody = body as AsyncIterable<Uint8Array | string>;
  if (typeof readableBody[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of readableBody) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("不支持的对象存储响应体类型");
};

export const uploadObjectToStorage = async ({
  key,
  body,
  contentType,
  bucketType = "private",
}: {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  bucketType?: StorageBucketType;
}) => {
  const client = getS3Client();
  const storageKey = normalizeStorageKey(key);
  const bucket = getBucketName(bucketType);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: body,
      ContentType: contentType,
    })
  );
};

export const getObjectFromStorage = async ({
  key,
  bucketType = "private",
}: {
  key: string;
  bucketType?: StorageBucketType;
}) => {
  const client = getS3Client();
  const storageKey = normalizeStorageKey(key);
  const bucket = getBucketName(bucketType);

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    })
  );

  const buffer = await toBuffer(response.Body);
  return {
    buffer,
    contentType: response.ContentType || "application/octet-stream",
    contentLength: response.ContentLength || buffer.byteLength,
    key: storageKey,
    bucket,
  };
};

export const listStorageObjectKeysByPrefix = async ({
  prefix,
  bucketType = "private",
}: {
  prefix: string;
  bucketType?: StorageBucketType;
}) => {
  const client = getS3Client();
  const normalizedPrefix = normalizeStorageKey(prefix).replace(/\/+$/, "") + "/";
  const bucket = getBucketName(bucketType);
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalizedPrefix,
        ContinuationToken: continuationToken,
      })
    );
    const contents = response.Contents || [];
    for (const item of contents) {
      if (item.Key) {
        keys.push(item.Key);
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
};

export const deleteStorageObjects = async ({
  keys,
  bucketType = "private",
}: {
  keys: string[];
  bucketType?: StorageBucketType;
}) => {
  if (keys.length === 0) return;

  const client = getS3Client();
  const bucket = getBucketName(bucketType);
  const normalizedKeys = keys.map((key) => normalizeStorageKey(key));

  for (let i = 0; i < normalizedKeys.length; i += 1000) {
    const batch = normalizedKeys.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((key) => ({ Key: key })),
          Quiet: true,
        },
      })
    );
  }
};

export const buildChatFileViewUrl = ({
  storagePath,
  download,
}: {
  storagePath: string;
  download?: boolean;
}) => {
  const normalizedPath = normalizeStorageKey(storagePath);
  const params = new URLSearchParams({
    storagePath: normalizedPath,
  });
  if (download) {
    params.set("download", "1");
  }
  return `/api/core/chat/files/view?${params.toString()}`;
};

export const getStorageFileName = (storagePath: string) => {
  const normalizedPath = normalizeStorageKey(storagePath);
  return path.posix.basename(normalizedPath) || "file";
};

export const assertChatStoragePath = (storagePath: string) => {
  const normalizedPath = normalizeStorageKey(storagePath);
  if (!normalizedPath.startsWith("chat_uploads/")) {
    throw new Error("无权限访问该文件");
  }
  return normalizedPath;
};

export const createPutObjectPresignedUrl = async ({
  key,
  contentType,
  expiresIn = 900,
  bucketType = "private",
}: {
  key: string;
  contentType?: string;
  expiresIn?: number;
  bucketType?: StorageBucketType;
}) => {
  const client = getS3Client();
  const storageKey = normalizeStorageKey(key);
  const bucket = getBucketName(bucketType);
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ContentType: contentType,
  });

  const url = await getSignedUrl(client, command, {
    expiresIn,
  });

  return {
    url,
    bucket,
    key: storageKey,
    method: "PUT" as const,
    headers: {
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
  };
};

export const createGetObjectPresignedUrl = async ({
  key,
  expiresIn = 1800,
  bucketType = "private",
}: {
  key: string;
  expiresIn?: number;
  bucketType?: StorageBucketType;
}) => {
  const client = getS3Client();
  const storageKey = normalizeStorageKey(key);
  const bucket = getBucketName(bucketType);
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: storageKey,
  });

  const url = await getSignedUrl(client, command, {
    expiresIn,
  });

  return {
    url,
    bucket,
    key: storageKey,
    method: "GET" as const,
  };
};
