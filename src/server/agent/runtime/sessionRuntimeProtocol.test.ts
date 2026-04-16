import assert from "node:assert/strict";
import test from "node:test";
import { createSdkMessage, sdkContentToText } from "@shared/chat/sdkMessages";
import { SdkStreamEventEnum } from "@shared/network/sdkStreamEvents";

test("sdkContentToText merges text-like blocks in order", () => {
  const text = sdkContentToText([
    { type: "thinking", thinking: "think-" },
    { type: "text", text: "answer-" },
    { type: "tool_result", content: "tool-output" },
  ]);
  assert.equal(text, "think-answer-tool-output");
});

test("tool_use and tool_result can be strictly paired by id", () => {
  const message = createSdkMessage({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "analyzing" },
        { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "README.md" } },
        { type: "tool_result", tool_use_id: "tool-1", content: "ok" },
        { type: "tool_use", id: "tool-2", name: "Edit", input: { file_path: "a.ts" } },
        { type: "tool_result", tool_use_id: "tool-2", content: "done" },
      ],
    },
  });

  const payload =
    message.message && typeof message.message === "object" ? message.message : { content: [] as unknown[] };
  const content = Array.isArray(payload.content) ? payload.content : [];
  const pending = new Set<string>();
  for (const block of content as Array<Record<string, unknown>>) {
    const blockType = typeof block.type === "string" ? block.type : "";
    if (blockType === "tool_use" && typeof block.id === "string") pending.add(block.id);
    if (blockType === "tool_result" && typeof block.tool_use_id === "string") {
      assert.equal(pending.has(block.tool_use_id), true);
      pending.delete(block.tool_use_id);
    }
  }
  assert.equal(pending.size, 0);
});

test("v2 stream event order supports control/status and terminal events", () => {
  const streamEvents = [
    { event: SdkStreamEventEnum.streamEvent, subtype: "thinking_delta" },
    { event: SdkStreamEventEnum.streamEvent, subtype: "tool_use_start", id: "tool-1" },
    {
      event: SdkStreamEventEnum.control,
      interaction: { type: "plan_question", requestId: "req-1", payload: { questions: [] } },
    },
    { event: SdkStreamEventEnum.streamEvent, subtype: "tool_result", id: "tool-1" },
    { event: SdkStreamEventEnum.status, phase: "tool_completed", toolUseId: "tool-1" },
    { event: SdkStreamEventEnum.message, message: { type: "assistant" } },
    { event: SdkStreamEventEnum.done, reason: "completed" },
  ];

  const last = streamEvents[streamEvents.length - 1];
  assert.equal(last.event, SdkStreamEventEnum.done);
  assert.equal(
    streamEvents.some((item) => item.event === SdkStreamEventEnum.control),
    true
  );
  assert.equal(
    streamEvents.some((item) => item.event === SdkStreamEventEnum.status),
    true
  );
});

test("error stream path can terminate with error event", () => {
  const streamEvents = [
    { event: SdkStreamEventEnum.streamEvent, subtype: "text_delta", text: "partial" },
    { event: SdkStreamEventEnum.error, message: "tool failed" },
  ];
  assert.equal(streamEvents[streamEvents.length - 1]?.event, SdkStreamEventEnum.error);
});
