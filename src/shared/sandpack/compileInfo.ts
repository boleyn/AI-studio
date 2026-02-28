export type SandpackCompileStatus = "idle" | "compiling" | "success" | "error" | "unknown";

export type SandpackCompileEvent = {
  type: string;
  text: string;
  timestamp: string;
};

export type SandpackConsoleLog = {
  method: string;
  text: string;
  timestamp: string;
};

export type SandpackCompileInfo = {
  status: SandpackCompileStatus;
  updatedAt: string;
  lastEventType?: string;
  lastEventText?: string;
  events: SandpackCompileEvent[];
  logs: SandpackConsoleLog[];
  errors: string[];
};

const MAX_ITEMS = 200;
const MAX_TEXT_LENGTH = 4000;

const toSafeString = (value: unknown): string => {
  if (typeof value === "string") return value.slice(0, MAX_TEXT_LENGTH);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value == null) return "";
  try {
    return JSON.stringify(value).slice(0, MAX_TEXT_LENGTH);
  } catch {
    return String(value).slice(0, MAX_TEXT_LENGTH);
  }
};

const toIsoTime = (value: unknown): string => {
  if (typeof value !== "string") return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return new Date().toISOString();
  return date.toISOString();
};

const toStatus = (value: unknown): SandpackCompileStatus => {
  if (
    value === "idle" ||
    value === "compiling" ||
    value === "success" ||
    value === "error" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
};

const normalizeEvent = (value: unknown): SandpackCompileEvent | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type = toSafeString(record.type).trim();
  const text = toSafeString(record.text).trim();
  if (!type && !text) return null;
  return {
    type: type || "unknown",
    text,
    timestamp: toIsoTime(record.timestamp),
  };
};

const normalizeLog = (value: unknown): SandpackConsoleLog | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const method = toSafeString(record.method).trim();
  const text = toSafeString(record.text).trim();
  if (!method && !text) return null;
  return {
    method: method || "log",
    text,
    timestamp: toIsoTime(record.timestamp),
  };
};

export const normalizeSandpackCompileInfo = (value: unknown): SandpackCompileInfo | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const events = Array.isArray(record.events)
    ? record.events.map(normalizeEvent).filter((item): item is SandpackCompileEvent => Boolean(item)).slice(-MAX_ITEMS)
    : [];
  const logs = Array.isArray(record.logs)
    ? record.logs.map(normalizeLog).filter((item): item is SandpackConsoleLog => Boolean(item)).slice(-MAX_ITEMS)
    : [];
  const errors = Array.isArray(record.errors)
    ? record.errors.map((item) => toSafeString(item).trim()).filter(Boolean).slice(-MAX_ITEMS)
    : [];

  return {
    status: toStatus(record.status),
    updatedAt: toIsoTime(record.updatedAt),
    lastEventType: toSafeString(record.lastEventType).trim() || undefined,
    lastEventText: toSafeString(record.lastEventText).trim() || undefined,
    events,
    logs,
    errors,
  };
};
