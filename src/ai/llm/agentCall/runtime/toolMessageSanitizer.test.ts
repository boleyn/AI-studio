import assert from "node:assert/strict";
import { test } from "node:test";
import { ChatCompletionRequestMessageRoleEnum } from "@aistudio/ai/compat/global/core/ai/constants";
import { sanitizeToolMessagesByToolCalls } from "./toolMessageSanitizer";

test("sanitizeToolMessagesByToolCalls drops orphan tool results", () => {
  const input = [
    {
      role: ChatCompletionRequestMessageRoleEnum.Assistant,
      tool_calls: [{ id: "call_ok", type: "function", function: { name: "Read", arguments: "{}" } }],
    },
    {
      role: ChatCompletionRequestMessageRoleEnum.Tool,
      tool_call_id: "call_ok",
      content: "good",
    },
    {
      role: ChatCompletionRequestMessageRoleEnum.Tool,
      tool_call_id: "call_orphan",
      content: "should drop",
    },
  ] as any[];

  const output = sanitizeToolMessagesByToolCalls(input as any);
  const toolMessages = output.filter((m: any) => m.role === ChatCompletionRequestMessageRoleEnum.Tool);
  assert.equal(toolMessages.length, 1);
  assert.equal(toolMessages[0]?.tool_call_id, "call_ok");
});
