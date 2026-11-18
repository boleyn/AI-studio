import { expect, test } from "bun:test";
import { contextIdentity, conversationFingerprint, replayCheckpoint, type ContextCheckpoint } from "./transcript";

test("history fingerprints survive UI trace flattening but reject edits and attachment changes", () => {
  const server = [{ role: "user", content: [{ type: "text", text: "inspect" }, { type: "image_url", image_url: { url: "fixture:a" } }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "internal" }, { type: "tool_use", name: "Read", input: {} }, { type: "text", text: "Verified.\n" }] }];
  const browser = [server[0], { role: "assistant", content: "Verified." }];
  expect(conversationFingerprint(server)).toBe(conversationFingerprint(browser));
  expect(conversationFingerprint([{ role: "user", content: "inspect" }])).toBe(conversationFingerprint([{ role: "user", content: [{ type: "text", text: "inspect" }] }]));
  expect(conversationFingerprint([server[0], { role: "assistant", content: "Unverified." }])).not.toBe(conversationFingerprint(server));
  expect(conversationFingerprint([{ role: "user", content: "inspect" }, browser[1]])).not.toBe(conversationFingerprint(server));
  expect(conversationFingerprint([{ role: "user", content: [{ type: "text", text: "inspect" }, { type: "image_url", image_url: { url: "fixture:b" } }] }, browser[1]])).not.toBe(conversationFingerprint(server));
  expect(conversationFingerprint(browser.slice(0, 1))).not.toBe(conversationFingerprint(browser));
});

test("cross-turn replay preserves prior tool protocol and prefix; changed environments invalidate it", () => {
  const identity = contextIdentity({ model: "sol", permission: "default" });
  const checkpoint: ContextCheckpoint = { version: 1, identity, messages: [
    { role: "user", content: "first" },
    { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "Read", arguments: '{}' } }] },
    { role: "tool", tool_call_id: "a", content: "observed" },
    { role: "assistant", content: "done" },
  ] };
  const before = JSON.stringify(checkpoint.messages);
  const current = [{ role: "user" as const, content: "second" }];
  const replay = replayCheckpoint(checkpoint, identity, current, []);
  expect(JSON.stringify(replay.slice(0, -1))).toBe(before);
  expect(replay.at(-1)).toEqual(current[0]);
  expect(replayCheckpoint(checkpoint, "changed", current, current)).toBe(current);
  expect(replayCheckpoint({ ...checkpoint, messages: [checkpoint.messages[2]] }, identity, current, current)).toBe(current);
});
