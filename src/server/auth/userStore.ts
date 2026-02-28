import { ObjectId } from "mongodb";
import { getMongoDb } from "../db/mongo";

export type UserDoc = {
  _id: ObjectId;
  username: string;
  passwordHash: string;
  contact?: string;
  provider?: "password" | "feishu";
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
  contact?: string;
  provider?: "password" | "feishu";
}) => {
  const users = await getUsersCollection();
  const now = new Date();
  const result = await users.insertOne({
    username: input.username,
    passwordHash: input.passwordHash,
    contact: input.contact,
    provider: input.provider ?? "password",
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
