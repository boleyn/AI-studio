import { getMongoDb } from "@server/db/mongo";

const MODEL_USAGE_EVENT_COLLECTION = "model_usage_events";

type ModelUsageEventDoc = {
  token: string;
  modelId: string;
  usedTokens: number;
  usedPercent?: number;
  time: Date;
  source: "image_vision";
};

export async function saveBackgroundUsage(input: { id: string; token: string; chatId: string; modelId: string; calls: number; totalTokens: number }) {
  const db = await getMongoDb();
  await db.collection<{ _id: string; token: string; chatId: string; source: string; modelId: string; calls: number; usedTokens: number; time: Date }>(MODEL_USAGE_EVENT_COLLECTION).updateOne(
    { _id: input.id },
    { $setOnInsert: { token: input.token, chatId: input.chatId, source: "background_agent", modelId: input.modelId, calls: input.calls, usedTokens: input.totalTokens, time: new Date() } },
    { upsert: true },
  );
}

const getModelUsageEventCollection = async () => {
  const db = await getMongoDb();
  const col = db.collection<ModelUsageEventDoc>(MODEL_USAGE_EVENT_COLLECTION);
  await Promise.all([
    col.createIndex({ token: 1, modelId: 1, time: -1 }),
    col.createIndex({ token: 1, time: -1 }),
  ]);
  return col;
};

export const appendModelUsageEvent = async (input: {
  token: string;
  modelId: string;
  usedTokens: number;
  usedPercent?: number;
  source?: "image_vision";
}) => {
  const token = input.token.trim();
  const modelId = input.modelId.trim();
  const usedTokens = Math.max(0, Math.floor(input.usedTokens));
  if (!token || !modelId || usedTokens <= 0) return;

  const usedPercent =
    typeof input.usedPercent === "number" && Number.isFinite(input.usedPercent)
      ? Math.max(0, Math.min(100, Number(input.usedPercent.toFixed(1))))
      : undefined;

  const col = await getModelUsageEventCollection();
  await col.insertOne({
    token,
    modelId,
    usedTokens,
    ...(usedPercent !== undefined ? { usedPercent } : {}),
    time: new Date(),
    source: input.source || "image_vision",
  });
};

