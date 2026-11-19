// @ts-nocheck
// @ts-nocheck
import path from "node:path";
import { Agent } from "node:https";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Readable } from "node:stream";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const transientStorageCodes = new Set([
  "TimeoutError", "NetworkingError", "ECONNRESET", "ETIMEDOUT",
  "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN",
]);

export function isMissingStorageObject(error: unknown) {
  const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return failure?.name === "NoSuchKey" || failure?.name === "NotFound" ||
    (failure?.$metadata?.httpStatusCode === 404 && failure.name !== "NoSuchBucket");
}

export function isStorageUnavailable(error: unknown) {
  const failure = error as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } } | null;
  const status = failure?.$metadata?.httpStatusCode ?? 0;
  return status === 429 || status >= 500 ||
    transientStorageCodes.has(failure?.name ?? "") || transientStorageCodes.has(failure?.code ?? "");
}

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
const STORAGE_PUBLIC_BASE_URL = process.env.STORAGE_PUBLIC_BASE_URL?.trim() || "";
const STORAGE_S3_FORCE_PATH_STYLE = parseBoolean(process.env.STORAGE_S3_FORCE_PATH_STYLE, true);
const STORAGE_S3_MAX_RETRIES = Number.parseInt(process.env.STORAGE_S3_MAX_RETRIES || "3", 10) || 3;
const STORAGE_PUBLIC_BUCKET = process.env.STORAGE_PUBLIC_BUCKET?.trim() || "";
const STORAGE_PRIVATE_BUCKET = process.env.STORAGE_PRIVATE_BUCKET?.trim() || "";
// AWS Signature V4 requires presigned URL expiration to be <= 7 days.
const MAX_SIGV4_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60 - 1;

let s3Client: S3Client | null = null;

const getBucketName = (bucketType: StorageBucketType) => {
  const bucket = bucketType === "public" ? STORAGE_PUBLIC_BUCKET : STORAGE_PRIVATE_BUCKET;
  if (!bucket) {
    throw new Error(`未配置对象存储桶: ${bucketType}`);
  }
  return bucket;
};

const trimSlash = (value: string) => value.replace(/\/+$/, "");
const clampSigV4ExpiresIn = (expiresIn: number) => {
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return 900;
  return Math.min(Math.floor(expiresIn), MAX_SIGV4_EXPIRES_IN_SECONDS);
};

export const getS3Client = () => {
  if (s3Client) return s3Client;

  if (!STORAGE_ACCESS_KEY_ID || !STORAGE_SECRET_ACCESS_KEY) {
    throw new Error("对象存储配置缺失：请检查 STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY");
  }

  const address = process.env.STORAGE_S3_CONNECT_IP?.trim();
  let requestHandler;
  if (address && STORAGE_S3_ENDPOINT) {
    const endpoint = new URL(STORAGE_S3_ENDPOINT);
    const family = isIP(address);
    if (!family || endpoint.protocol !== "https:") throw new Error("对象存储直连需要 HTTPS 端点和有效 IP 地址");
    requestHandler = new NodeHttpHandler({ httpsAgent: new Agent({ keepAlive: true,
      lookup(hostname, options, callback) {
        if (hostname !== endpoint.hostname) return lookup(hostname, options, callback);
        if (options.all) return callback(null, [{ address, family }]);
        callback(null, address, family);
      },
    }) });
  }
  s3Client = new S3Client({
    requestHandler,
    region: STORAGE_REGION,
    endpoint: STORAGE_S3_ENDPOINT || undefined,
    forcePathStyle: STORAGE_S3_FORCE_PATH_STYLE,
    maxAttempts: STORAGE_S3_MAX_RETRIES,
    // Presigned PUTs are signed before the browser supplies the file bytes.
    requestChecksumCalculation: "WHEN_REQUIRED",
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

export const listStorageObjectsByPrefix = async ({
  prefix,
  bucketType = "private",
  directory = true,
}: {
  prefix: string;
  bucketType?: StorageBucketType;
  directory?: boolean;
}) => {
  const client = getS3Client();
  const key = normalizeStorageKey(prefix);
  const normalizedPrefix = directory ? key.replace(/\/+$/, "") + "/" : key;
  const bucket = getBucketName(bucketType);
  const objects: { key: string; lastModified?: Date }[] = [];
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
        objects.push({ key: item.Key, lastModified: item.LastModified });
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
};

export const listStorageObjectKeysByPrefix = async (options: Parameters<typeof listStorageObjectsByPrefix>[0]) =>
  (await listStorageObjectsByPrefix(options)).map(({ key }) => key);

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
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((key) => ({ Key: key })),
          Quiet: true,
        },
      })
    );
    if (result.Errors?.length) throw new Error("Storage could not delete all requested objects");
  }
};

export const buildChatFileViewUrl = ({
  storagePath,
  token,
  chatId,
  download,
}: {
  storagePath: string;
  token?: string;
  chatId?: string;
  download?: boolean;
}) => {
  const normalizedPath = normalizeStorageKey(storagePath);
  const params = new URLSearchParams({
    storagePath: normalizedPath,
  });
  if (token) {
    params.set("token", token);
  }
  if (chatId) {
    params.set("chatId", chatId);
  }
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
    expiresIn: clampSigV4ExpiresIn(expiresIn),
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
    expiresIn: clampSigV4ExpiresIn(expiresIn),
  });

  return {
    url,
    bucket,
    key: storageKey,
    method: "GET" as const,
  };
};

export const buildPublicObjectUrl = ({
  key,
  bucketType = "public",
}: {
  key: string;
  bucketType?: StorageBucketType;
}) => {
  const storageKey = normalizeStorageKey(key);
  const bucket = getBucketName(bucketType);

  if (STORAGE_PUBLIC_BASE_URL) {
    return `${trimSlash(STORAGE_PUBLIC_BASE_URL)}/${storageKey}`;
  }

  if (STORAGE_S3_ENDPOINT) {
    const endpoint = trimSlash(STORAGE_S3_ENDPOINT);
    if (STORAGE_S3_FORCE_PATH_STYLE) {
      return `${endpoint}/${bucket}/${storageKey}`;
    }
    const withoutProtocol = endpoint.replace(/^https?:\/\//i, "");
    const protocol = endpoint.startsWith("http://") ? "http://" : "https://";
    return `${protocol}${bucket}.${withoutProtocol}/${storageKey}`;
  }

  return `https://${bucket}.s3.${STORAGE_REGION}.amazonaws.com/${storageKey}`;
};
