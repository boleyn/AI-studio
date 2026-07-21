import { ObjectId } from "mongodb";
import { getMongoDb } from "@server/db/mongo";

type SnapshotFileMap = Record<string, { code: string }>;

type FileSnapshotDoc = {
  _id: ObjectId;
  token: string;
  chatId: string;
  assistantMessageId: string;
  files: SnapshotFileMap;
  createdAt: Date;
};

const COLLECTION = "chat_file_snapshots";
const KEEP_LIMIT_PER_CHAT = 120;

const getCollection = async () => {
  const db = await getMongoDb();
  const col = db.collection<FileSnapshotDoc>(COLLECTION);
  await Promise.all([
    col.createIndex({ token: 1, chatId: 1, assistantMessageId: 1 }, { unique: true }),
    col.createIndex({ token: 1, chatId: 1, createdAt: -1 }),
  ]);
  return col;
};

const normalizeFiles = (files: SnapshotFileMap): SnapshotFileMap => {
  const out: SnapshotFileMap = {};
  for (const [rawPath, value] of Object.entries(files || {})) {
    if (!rawPath || typeof rawPath !== "string") continue;
    const normalizedPath = rawPath.replace(/\\/g, "/").trim();
    if (!normalizedPath) continue;
    const workspacePath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
    if (!value || typeof value !== "object" || typeof value.code !== "string") continue;
    out[workspacePath] = { code: value.code };
  }
  return out;
};

export const saveChatFileSnapshot = async ({
  token,
  chatId,
  assistantMessageId,
  files,
}: {
  token: string;
  chatId: string;
  assistantMessageId: string;
  files: SnapshotFileMap;
}) => {
  const safeToken = token.trim();
  const safeChatId = chatId.trim();
  const safeAssistantMessageId = assistantMessageId.trim();
  if (!safeToken || !safeChatId || !safeAssistantMessageId) return;
  const col = await getCollection();
  await col.updateOne(
    { token: safeToken, chatId: safeChatId, assistantMessageId: safeAssistantMessageId },
    {
      $set: {
        token: safeToken,
        chatId: safeChatId,
        assistantMessageId: safeAssistantMessageId,
        files: normalizeFiles(files),
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  const overflowDocs = await col
    .find({ token: safeToken, chatId: safeChatId }, { projection: { _id: 1 } })
    .sort({ createdAt: -1, _id: -1 })
    .skip(KEEP_LIMIT_PER_CHAT)
    .toArray();
  if (overflowDocs.length > 0) {
    await col.deleteMany({ _id: { $in: overflowDocs.map((doc) => doc._id) } });
  }
};

export const getChatFileSnapshotByAssistantMessageId = async ({
  token,
  chatId,
  assistantMessageId,
}: {
  token: string;
  chatId: string;
  assistantMessageId: string;
}): Promise<SnapshotFileMap | null> => {
  const safeToken = token.trim();
  const safeChatId = chatId.trim();
  const safeAssistantMessageId = assistantMessageId.trim();
  if (!safeToken || !safeChatId || !safeAssistantMessageId) return null;
  const col = await getCollection();
  const doc = await col.findOne({
    token: safeToken,
    chatId: safeChatId,
    assistantMessageId: safeAssistantMessageId,
  });
  if (!doc?.files || typeof doc.files !== "object") return null;
  const normalized = normalizeFiles(doc.files);
  return Object.keys(normalized).length > 0 ? normalized : {};
};
