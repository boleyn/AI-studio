import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupeToolCallsInRound } from "./toolCallNormalizer";

test("dedupeToolCallsInRound keeps first call for same tool+normalized args", () => {
  const calls = [
    {
      id: "a",
      type: "function",
      function: { name: "Read", arguments: "{\n  \"file_path\": \"a\"\n}" },
    },
    {
      id: "b",
      type: "function",
      function: { name: "Read", arguments: "{\"file_path\":\"a\"}" },
    },
    {
      id: "c",
      type: "function",
      function: { name: "Read", arguments: "{\"file_path\":\"b\"}" },
    },
  ] as any[];

  const output = dedupeToolCallsInRound(calls as any);
  assert.equal(output.length, 2);
  assert.equal(output[0]?.id, "a");
  assert.equal(output[1]?.id, "c");
});
