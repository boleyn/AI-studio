import assert from "node:assert/strict";
import test from "node:test";
import { mergeSdkBlock } from "./sdkBlockMerge";

test("mergeSdkBlock updates duplicate agent child tool blocks by id", () => {
  const blocks = mergeSdkBlock(
    [
      {
        type: "tool_use",
        id: "toolu_child",
        name: "Read",
        input: {},
        parent_agent_tool_use_id: "toolu_agent",
      },
    ],
    {
      type: "tool_use",
      id: "toolu_child",
      name: "Read",
      input: { file_path: "src/app.tsx" },
      parent_agent_tool_use_id: "toolu_agent",
    }
  );

  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], {
    type: "tool_use",
    id: "toolu_child",
    name: "Read",
    input: { file_path: "src/app.tsx" },
    parent_agent_tool_use_id: "toolu_agent",
  });
});

test("mergeSdkBlock updates duplicate agent child tool results by tool_use_id", () => {
  const blocks = mergeSdkBlock(
    [
      {
        type: "tool_result",
        tool_use_id: "toolu_child",
        content: "",
        parent_agent_tool_use_id: "toolu_agent",
      },
    ],
    {
      type: "tool_result",
      tool_use_id: "toolu_child",
      content: "ok",
      parent_agent_tool_use_id: "toolu_agent",
    }
  );

  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], {
    type: "tool_result",
    tool_use_id: "toolu_child",
    content: "ok",
    parent_agent_tool_use_id: "toolu_agent",
    input: undefined,
    is_error: false,
    name: undefined,
  });
});
