import { createHash } from "node:crypto";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { conversationGroups } from "./budget";

export type ContextCheckpoint = {
  version: 1;
  taskReceipts?: string[];
  identity: string;
  messages: ChatCompletionMessageParam[];
};
export const contextIdentity = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** The UI persists assistant prose separately from trace blocks. Match visible
 * history across that representation change; user attachments remain significant. */
export function conversationFingerprint(history: unknown[]): string {
  return contextIdentity(history.map((value) => {
    const item = value as { role?: string; type?: string; content?: unknown; message?: { role?: string; content?: unknown } };
    const role = item.role || item.message?.role || item.type;
    const content = item.content ?? item.message?.content;
    const blocks = Array.isArray(content) ? content : [content];
    const text = blocks.map(block => typeof block === "string" ? block
      : block?.type === "text" && typeof block.text === "string" ? block.text : "").join("").trim();
    const nonText = role === "assistant" ? [] : blocks.filter(block => block != null && typeof block !== "string" && block.type !== "text");
    return { role, text, nonText };
  }));
}

/** A checkpoint is only accepted after the gateway verifies the persisted chat
 * fingerprint. Environment/permission/model changes invalidate replay as well. */
export function replayCheckpoint(checkpoint: ContextCheckpoint | undefined, identity: string, current: ChatCompletionMessageParam[], fallback: ChatCompletionMessageParam[]) {
  if (!checkpoint || checkpoint.version !== 1 || checkpoint.identity !== identity || !Array.isArray(checkpoint.messages)) return fallback;
  try { conversationGroups(checkpoint.messages); } catch { return fallback; }
  return [...checkpoint.messages, ...current];
}
