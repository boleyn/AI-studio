type UnknownRecord = Record<string, unknown>;

export type ReadSnapshot = {
  filePath: string;
  content: string;
  isPartial: boolean;
  observedAt: number;
};

export type ReadSnapshotStore = Map<string, ReadSnapshot>;

const toRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;

const toString = (value: unknown) => (typeof value === "string" ? value : "");

const toNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const normalizePath = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed.replace(/\/{2,}/g, "/") : `/${trimmed.replace(/^\/+/, "")}`;
};

const parsePossiblyNestedJson = (value: unknown): unknown => {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "string") break;
    const trimmed = current.trim();
    if (!trimmed) break;
    try {
      current = JSON.parse(trimmed);
      continue;
    } catch {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const sliced = trimmed.slice(start, end + 1);
        try {
          current = JSON.parse(sliced);
          continue;
        } catch {
          // noop
        }
      }
      break;
    }
  }
  return current;
};

const snapshotFromReadPayload = (payload: unknown): ReadSnapshot | null => {
  const root = toRecord(payload);
  if (!root) return null;

  const file = toRecord(root.file);
  if (file) {
    const filePath = normalizePath(toString(file.filePath));
    const content = toString(file.content);
    if (!filePath) return null;
    const startLine = toNumber(file.startLine) ?? 1;
    const numLines = toNumber(file.numLines);
    const totalLines = toNumber(file.totalLines);
    const isPartial =
      startLine > 1 ||
      (typeof numLines === "number" &&
        typeof totalLines === "number" &&
        totalLines > 0 &&
        numLines < totalLines);
    return {
      filePath,
      content,
      isPartial,
      observedAt: Date.now(),
    };
  }

  const data = toRecord(root.data);
  if (!data) return null;
  const filePath = normalizePath(toString(data.path));
  const content = toString(data.content);
  if (!filePath) return null;
  return {
    filePath,
    content,
    isPartial: false,
    observedAt: Date.now(),
  };
};

export const ensureAbsoluteFilePath = (filePath: string, field = "file_path") => {
  const normalized = normalizePath(filePath);
  if (!normalized || !normalized.startsWith("/")) {
    throw new Error(`${field} 必须是绝对路径（以 / 开头）`);
  }
  return normalized;
};

export const createReadSnapshotStore = (messages?: unknown[]): ReadSnapshotStore => {
  const store: ReadSnapshotStore = new Map();
  if (!Array.isArray(messages) || messages.length === 0) return store;

  for (const message of messages) {
    const record = toRecord(message);
    if (!record) continue;
    if (toString(record.role) !== "tool") continue;
    if (toString(record.name) !== "Read") continue;
    const payload = parsePossiblyNestedJson(record.content);
    const snapshot = snapshotFromReadPayload(payload);
    if (!snapshot) continue;
    store.set(snapshot.filePath, snapshot);
  }

  return store;
};

export const markReadSnapshot = (
  store: ReadSnapshotStore,
  input: {
    filePath: string;
    content: string;
    isPartial: boolean;
  }
) => {
  const filePath = normalizePath(input.filePath);
  if (!filePath) return;
  store.set(filePath, {
    filePath,
    content: input.content,
    isPartial: input.isPartial,
    observedAt: Date.now(),
  });
};

export const clearReadSnapshot = (store: ReadSnapshotStore, filePath: string) => {
  const normalized = normalizePath(filePath);
  if (!normalized) return;
  store.delete(normalized);
};

export const getReadSnapshot = (store: ReadSnapshotStore, filePath: string) => {
  const normalized = normalizePath(filePath);
  if (!normalized) return undefined;
  return store.get(normalized);
};

