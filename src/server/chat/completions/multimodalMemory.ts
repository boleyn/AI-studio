import { createGetObjectPresignedUrl } from "@server/storage/s3";

export type ImageInputPart = { type: "image_url"; image_url: { url: string }; key?: string };
export type FileInputPart = { type: "file_url"; name: string; url: string; key?: string };
export type UserInputPart = ImageInputPart | FileInputPart;

export const isImageInputPart = (value: unknown): value is ImageInputPart => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type !== "image_url") return false;
  if (typeof record.key !== "undefined" && typeof record.key !== "string") return false;
  const imageUrl = record.image_url;
  if (!imageUrl || typeof imageUrl !== "object") return false;
  return typeof (imageUrl as Record<string, unknown>).url === "string";
};

export const toArtifactFileParts = (artifact: unknown): UserInputPart[] => {
  if (!artifact || typeof artifact !== "object") return [];

  const files = Array.isArray((artifact as { files?: unknown }).files)
    ? ((artifact as { files?: unknown }).files as unknown[])
    : [];

  const output: UserInputPart[] = [];
  for (const item of files) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
    const url =
      (typeof record.previewUrl === "string" && record.previewUrl) ||
      (typeof record.publicUrl === "string" && record.publicUrl) ||
      "";
    const key = typeof record.storagePath === "string" ? record.storagePath : undefined;
    if (!url && !key) continue;

    if (type.startsWith("image/")) {
      output.push({
        type: "image_url",
        image_url: { url: url || "" },
        key,
      });
      continue;
    }

    output.push({
      type: "file_url",
      name: name || "file",
      url: url || "",
      key,
    });
  }

  return output;
};

export const isInternalChatFileUrl = (url: string) => /^\/api\/core\/chat\/files\/view\?/i.test(url);

const toAbsoluteKey = (key?: string) => {
  if (!key) return "";
  return key.replace(/^\/+/, "");
};

export const resolveSignedFileUrl = async ({
  key,
  fallbackUrl,
  cache,
}: {
  key?: string;
  fallbackUrl?: string;
  cache: Map<string, string>;
}) => {
  const normalizedKey = toAbsoluteKey(key);
  if (!normalizedKey) return fallbackUrl || "";
  const cached = cache.get(normalizedKey);
  if (cached) return cached;
  try {
    const signed = await createGetObjectPresignedUrl({
      key: normalizedKey,
      bucketType: "private",
      expiresIn: 3600,
    });
    cache.set(normalizedKey, signed.url);
    return signed.url;
  } catch {
    return fallbackUrl || "";
  }
};
