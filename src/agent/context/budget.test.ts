import { expect, test } from "bun:test";
import { conversationGroups, requestTokens } from "./budget";
import { compressContextIfNeeded } from "../app/compressor";
import { ContextArtifacts } from "./artifacts";
import type { SandboxFileSystem } from "../sandbox/types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AgentModelClient } from "../app/modelClient";
const stored = new Map<string, string>();
const artifacts = new ContextArtifacts({ writeFile: async (p: string, s: string) => { stored.set(p, s); } } as SandboxFileSystem);
const call: ChatCompletionMessageParam = { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "Read", arguments: '{"file_path":"/a"}' } }, { id: "b", type: "function", function: { name: "Read", arguments: '{"file_path":"/b"}' } }] };
const round: ChatCompletionMessageParam[] = [call, { role: "tool", tool_call_id: "a", content: "A" }, { role: "tool", tool_call_id: "b", content: "B" }];
const base = { client: {} as AgentModelClient, model: "test", maxContext: 8192, tools: [], systemPrompt: "system", artifacts };

test("budget includes schema, system and tool call arguments", () => {
  expect(requestTokens("long ".repeat(1000), [], [])).toBeGreaterThan(1000);
  const huge = { ...call, tool_calls: [{ id: "x", type: "function", function: { name: "Write", arguments: "x ".repeat(2000) } }] } as ChatCompletionMessageParam;
  expect(requestTokens("", [], [huge])).toBeGreaterThan(2000);
});
test("tool rounds are atomic and orphan results are rejected", () => {
  expect(conversationGroups(round)).toHaveLength(1);
  expect(() => conversationGroups(round.slice(1))).toThrow("orphan");
  expect(() => conversationGroups(round.slice(0, 2))).toThrow("incomplete");
});
test("ordinary turns remain byte-identical", async () => {
  const messages: ChatCompletionMessageParam[] = [{ role: "user", content: "hello" }, ...round];
  const result = await compressContextIfNeeded({ ...base, messages });
  expect(result.messages).toBe(messages);
  expect(result.compacted).toBe(false);
});
test("long single-turn runs archive complete rounds and keep pending results and latest request", async () => {
  const messages: ChatCompletionMessageParam[] = [{ role: "user", content: "retain this goal" }];
  for (let i = 0; i < 30; i++) messages.push({ role: "assistant", content: `old reasoning ${i} `.repeat(200) });
  messages.push(...round);
  const result = await compressContextIfNeeded({ ...base, messages });
  expect(result.compacted).toBe(true);
  expect(result.messages.slice(-3)).toEqual(round);
  expect(result.messages.some(m => m.content === "retain this goal")).toBe(true);
  expect(result.messages[0].role).toBe("user");
  expect([...stored.values()].some(s => s.includes('"tool_call_id":"b"'))).toBe(true);
});
test("one oversized message is bounded rather than bypassing compression", async () => {
  const result = await compressContextIfNeeded({ ...base, messages: [{ role: "user", content: "中文 data ".repeat(10000) }] });
  expect(result.compacted).toBe(true);
  expect(requestTokens(base.systemPrompt, [], result.messages)).toBeLessThan(base.maxContext);
});

test("successive compactions preserve a previous user constraint even when summarization is offline", async () => {
  const constraint = "Only modify docs/releases and quote the exact release ID.";
  const history: ChatCompletionMessageParam[] = [{ role: "user", content: constraint }];
  const filler: ChatCompletionMessageParam = { role: "assistant", content: "large observation ".repeat(5000) };
  const one = await compressContextIfNeeded({ ...base, messages: [...history, filler, { role: "user", content: "Check release 41." }] });
  const two = await compressContextIfNeeded({ ...base, messages: [...one.messages, filler, { role: "user", content: "Continue." }] });
  expect(two.compacted).toBe(true);
  expect(two.messages[0].content).toContain(constraint);
  expect(two.messages.at(-1)?.content).toBe("Continue.");
});
