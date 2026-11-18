import { getMongoDb } from "../db/mongo";
import { conversationFingerprint as fingerprint, type ContextCheckpoint } from "@/agent/context/transcript";

// Separate collection: never return internal tool observations in chat/UI payloads.
export async function loadAgentContext(token: string, chatId: string, history: unknown[]): Promise<ContextCheckpoint | undefined> {
  const db = await getMongoDb();
  const record = await db.collection("agent_context_checkpoints").findOne({ token, chatId });
  if (!record || record.historyHash !== fingerprint(history)) return;
  return record.checkpoint as ContextCheckpoint;
}
export async function saveAgentContext(token: string, chatId: string, history: unknown[], checkpoint: ContextCheckpoint) {
  const db = await getMongoDb();
  await db.collection("agent_context_checkpoints").updateOne({ token, chatId }, { $set: {
    token, chatId, historyHash: fingerprint(history), checkpoint, updatedAt: new Date(),
  } }, { upsert: true });
}

// Save the goal separately so stopping a stream before transcript commit preserves its objective.
export async function loadConversationGoal(token: string, chatId: string) {
  const db = await getMongoDb();
  const doc = await db.collection("agent_context_checkpoints").findOne({ token, chatId }, { projection: { goal: 1 } });
  return doc?.goal as import("@/agent/app/goal").SessionGoal | undefined;
}

export async function saveConversationGoal(token: string, chatId: string, goal: import("@/agent/app/goal").SessionGoal) {
  const db = await getMongoDb();
  await db.collection("agent_context_checkpoints").updateOne({ token, chatId }, { $set: { goal } }, { upsert: true });
}
