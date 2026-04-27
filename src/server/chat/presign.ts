// @ts-nocheck
// @ts-nocheck
const DEFAULT_CHAT_FILE_GET_URL_EXPIRES_IN = 30 * 24 * 60 * 60;
// AWS Signature V4 requires presigned URL expiration to be strictly less than one week.
const MAX_SIGV4_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60 - 1;

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

// Chat file preview links default to 30 days in config, but must be clamped for SigV4.
export const CHAT_FILE_GET_URL_EXPIRES_IN_SECONDS = Math.min(
  toPositiveInt(
    process.env.CHAT_FILE_GET_URL_EXPIRES_IN_SECONDS,
    DEFAULT_CHAT_FILE_GET_URL_EXPIRES_IN
  ),
  MAX_SIGV4_EXPIRES_IN_SECONDS
);
