import { ObjectId } from "mongodb";
import type { SideChatMessage, SideChatThread } from "@features/chat/types/selectionChat";
import { getMongoDb } from "../db/mongo";

type SideChatDoc = {
  _id: ObjectId;
  token: string;
  chatId: string;
  threadId: string;
  sourceMessageId?: string;
  quoteText: string;
  title: string;
  messages: SideChatMessage[];
  createTime: Date;
  updateTime: Date;
};

const COLLECTION = "conversation_side_chats";
let indexesReady: Promise<void> | null = null;

const getCollection = async () => {
  const db = await getMongoDb();
  const collection = db.collection<SideChatDoc>(COLLECTION);
  if (!indexesReady) {
    indexesReady = collection
      .createIndexes([
        { key: { token: 1, chatId: 1, updateTime: -1 } },
        { key: { token: 1, chatId: 1, threadId: 1 }, unique: true },
      ])
      .then(() => undefined)
      .catch(() => {
        indexesReady = null;
      });
  }
  await indexesReady;
  return collection;
};

const toSideChatThread = (doc: SideChatDoc): SideChatThread => ({
  id: doc.threadId,
  token: doc.token,
  chatId: doc.chatId,
  ...(doc.sourceMessageId ? { sourceMessageId: doc.sourceMessageId } : {}),
  quoteText: doc.quoteText || "",
  title: doc.title || doc.quoteText?.slice(0, 32) || "侧边聊天",
  messages: Array.isArray(doc.messages) ? doc.messages : [],
  createdAt: (doc.createTime instanceof Date ? doc.createTime : new Date()).toISOString(),
  updatedAt: (doc.updateTime instanceof Date ? doc.updateTime : new Date()).toISOString(),
});

export const listSideChats = async (
  token: string,
  chatId: string
): Promise<SideChatThread[]> => {
  if (!token || !chatId) return [];
  const collection = await getCollection();
  const docs = await collection
    .find({ token, chatId })
    .sort({ updateTime: -1 })
    .limit(50)
    .toArray();
  return docs.map(toSideChatThread);
};

export const getSideChat = async (
  token: string,
  chatId: string,
  threadId: string
): Promise<SideChatThread | null> => {
  if (!token || !chatId || !threadId) return null;
  const collection = await getCollection();
  const doc = await collection.findOne({ token, chatId, threadId });
  return doc ? toSideChatThread(doc) : null;
};

export const upsertSideChat = async ({
  token,
  chatId,
  threadId,
  sourceMessageId,
  quoteText,
  title,
  messages,
}: {
  token: string;
  chatId: string;
  threadId: string;
  sourceMessageId?: string;
  quoteText: string;
  title?: string;
  messages: SideChatMessage[];
}): Promise<SideChatThread> => {
  const collection = await getCollection();
  const now = new Date();
  const resolvedTitle =
    (title || "").trim() ||
    quoteText.replace(/\s+/g, " ").trim().slice(0, 36) ||
    "侧边聊天";

  await collection.updateOne(
    { token, chatId, threadId },
    {
      $set: {
        quoteText,
        title: resolvedTitle,
        messages,
        updateTime: now,
        ...(sourceMessageId ? { sourceMessageId } : {}),
      },
      $setOnInsert: {
        token,
        chatId,
        threadId,
        createTime: now,
      },
    },
    { upsert: true }
  );

  const saved = await collection.findOne({ token, chatId, threadId });
  if (saved) return toSideChatThread(saved);

  return {
    id: threadId,
    token,
    chatId,
    ...(sourceMessageId ? { sourceMessageId } : {}),
    quoteText,
    title: resolvedTitle,
    messages,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
};

export const deleteSideChat = async (
  token: string,
  chatId: string,
  threadId: string
): Promise<boolean> => {
  if (!token || !chatId || !threadId) return false;
  const collection = await getCollection();
  const result = await collection.deleteOne({ token, chatId, threadId });
  return result.deletedCount > 0;
};
