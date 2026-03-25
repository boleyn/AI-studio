import { ObjectId } from "mongodb";
import { getMongoDb } from "../db/mongo";

export type UserDoc = {
  _id: ObjectId;
  username: string;
  passwordHash: string;
  displayName?: string;
  contact?: string;
  avatar?: string;
  provider?: "password" | "feishu";
  feishuOpenId?: string;
  feishuUnionId?: string;
  createdAt: Date;
  updatedAt: Date;
};

const COLLECTION = "users";

const getUsersCollection = async () => {
  const db = await getMongoDb();
  return db.collection<UserDoc>(COLLECTION);
};

export const findUserByUsername = async (username: string) => {
  const users = await getUsersCollection();
  return users.findOne({ username });
};

export const findUserById = async (id: string) => {
  const users = await getUsersCollection();
  return users.findOne({ _id: new ObjectId(id) });
};

export const createUser = async (input: {
  username: string;
  passwordHash: string;
  displayName?: string;
  contact?: string;
  avatar?: string;
  provider?: "password" | "feishu";
  feishuOpenId?: string;
  feishuUnionId?: string;
}) => {
  const users = await getUsersCollection();
  const now = new Date();
  const result = await users.insertOne({
    username: input.username,
    passwordHash: input.passwordHash,
    displayName: input.displayName,
    contact: input.contact,
    avatar: input.avatar,
    provider: input.provider ?? "password",
    feishuOpenId: input.feishuOpenId,
    feishuUnionId: input.feishuUnionId,
    createdAt: now,
    updatedAt: now,
  } as UserDoc);
  return result.insertedId;
};

export const updateUserPassword = async (userId: string, passwordHash: string) => {
  const users = await getUsersCollection();
  const result = await users.updateOne(
    { _id: new ObjectId(userId) },
    { $set: { passwordHash, updatedAt: new Date() } }
  );
  return result.modifiedCount > 0;
};

export const updateUserProfile = async (
  userId: string,
  patch: {
    displayName?: string;
    contact?: string;
    avatar?: string;
    feishuOpenId?: string;
    feishuUnionId?: string;
  }
) => {
  const users = await getUsersCollection();
  const setDoc: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof patch.displayName === "string") {
    setDoc.displayName = patch.displayName;
  }
  if (typeof patch.contact === "string") {
    setDoc.contact = patch.contact;
  }
  if (typeof patch.avatar === "string") {
    setDoc.avatar = patch.avatar;
  }
  if (typeof patch.feishuOpenId === "string") {
    setDoc.feishuOpenId = patch.feishuOpenId;
  }
  if (typeof patch.feishuUnionId === "string") {
    setDoc.feishuUnionId = patch.feishuUnionId;
  }
  const result = await users.updateOne({ _id: new ObjectId(userId) }, { $set: setDoc });
  return result.modifiedCount > 0;
};
