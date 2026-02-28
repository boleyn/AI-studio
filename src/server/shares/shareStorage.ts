import { randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getMongoDb } from "../db/mongo";

export type ShareMode = "editable" | "preview";

export type ShareLinkData = {
  shareId: string;
  projectToken: string;
  mode: ShareMode;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
};

type ShareLinkDoc = ShareLinkData & {
  _id: ObjectId;
};

const COLLECTION = "share_links";

async function getCollection() {
  const db = await getMongoDb();
  return db.collection<ShareLinkDoc>(COLLECTION);
}

async function ensureIndexes() {
  const coll = await getCollection();
  await coll.createIndex({ shareId: 1 }, { unique: true });
  await coll.createIndex({ projectToken: 1, mode: 1 });
}

function generateShareId(): string {
  return randomBytes(12).toString("hex");
}

export async function createShareLink(params: {
  projectToken: string;
  mode: ShareMode;
  ownerUserId: string;
}): Promise<ShareLinkData> {
  await ensureIndexes();
  const coll = await getCollection();
  const now = new Date().toISOString();

  for (let i = 0; i < 5; i += 1) {
    const shareId = generateShareId();
    const doc: Omit<ShareLinkDoc, "_id"> = {
      shareId,
      projectToken: params.projectToken,
      mode: params.mode,
      ownerUserId: params.ownerUserId,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await coll.insertOne(doc as ShareLinkDoc);
      return doc;
    } catch (error) {
      const maybeCode = (error as { code?: number })?.code;
      if (maybeCode === 11000) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("分享链接生成失败，请重试");
}

export async function getShareLink(shareId: string): Promise<ShareLinkData | null> {
  if (!shareId) return null;
  const coll = await getCollection();
  const doc = await coll.findOne({ shareId });
  if (!doc) return null;
  return {
    shareId: doc.shareId,
    projectToken: doc.projectToken,
    mode: doc.mode,
    ownerUserId: doc.ownerUserId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
