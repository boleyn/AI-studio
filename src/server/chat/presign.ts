const DEFAULT_CHAT_FILE_GET_URL_EXPIRES_IN = 30 * 24 * 60 * 60;

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

// Chat file preview links default to 30 days; can be overridden by env.
export const CHAT_FILE_GET_URL_EXPIRES_IN_SECONDS = toPositiveInt(
  process.env.CHAT_FILE_GET_URL_EXPIRES_IN_SECONDS,
  DEFAULT_CHAT_FILE_GET_URL_EXPIRES_IN
);

