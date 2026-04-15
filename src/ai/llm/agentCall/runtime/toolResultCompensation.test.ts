import assert from "node:assert/strict";
import { test } from "node:test";
import { ChatCompletionRequestMessageRoleEnum } from "@aistudio/ai/compat/global/core/ai/constants";
import {
  collectMissingToolResults,
  createSyntheticToolResultMessage,
} from "./toolResultCompensation";

test("collectMissingToolResults returns unresolved tool calls only", () => {
  const messages = [
    {
      role: ChatCompletionRequestMessageRoleEnum.Assistant,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "Read", arguments: "{}" } },
        { id: "call_2", type: "function", function: { name: "Write", arguments: "{}" } },
      ],
    },
    {
      role: ChatCompletionRequestMessageRoleEnum.Tool,
      tool_call_id: "call_1",
      content: "ok",
    },
  ] as any[];

  const missing = collectMissingToolResults(messages as any);
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.toolCallId, "call_2");
  assert.equal(missing[0]?.toolName, "Write");
});

test("createSyntheticToolResultMessage creates tool-result shaped fallback", () => {
  const synthetic = createSyntheticToolResultMessage("call_x", "interrupted");
  assert.equal(synthetic.role, ChatCompletionRequestMessageRoleEnum.Tool);
  assert.equal((synthetic as { tool_call_id?: string }).tool_call_id, "call_x");
  assert.match(String((synthetic as { content?: string }).content || ""), /interrupted/);
});
