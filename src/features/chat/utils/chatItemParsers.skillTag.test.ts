import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage } from "@/types/conversation";
import {
  composeTimelineItems,
  getTimelineItems,
  type TimelineItem,
  type ToolDetail,
} from "./chatItemParsers";

test("getTimelineItems extracts skill tag from Skill tool params/result", () => {
  const message = {
    role: "assistant",
    content: "",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_skill_1",
          name: "Skill",
          input: { skill: "/commit" },
        },
        {
          type: "tool_result",
          tool_use_id: "toolu_skill_1",
          content: JSON.stringify({
            success: true,
            commandName: "commit",
            status: "inline",
          }),
        },
      ],
    },
  } as unknown as ConversationMessage;

  const items = getTimelineItems(message);
  const toolItem = items.find((item) => item.type === "tool");
  assert.ok(toolItem);
  assert.equal(toolItem?.toolName, "Skill");
  assert.equal(toolItem?.skillTag, "commit");
});

test("composeTimelineItems keeps child agent tools under their agent", () => {
  const rawTimelineItems: TimelineItem[] = [
    {
      type: "agent",
      id: "toolu_agent",
      agentType: "Explore",
      children: [],
    },
  ];
  const toolDetails: ToolDetail[] = [
    {
      id: "toolu_child",
      toolName: "Read",
      params: JSON.stringify({ file_path: "src/app.tsx" }),
      response: "ok",
      parentAgentToolUseId: "toolu_agent",
      progressStatus: "completed",
    },
  ];

  const items = composeTimelineItems({
    rawTimelineItems,
    reasoningText: "",
    toolDetails,
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.type, "agent");
  assert.equal(items[0]?.children?.length, 1);
  assert.equal(items[0]?.children?.[0]?.type, "tool");
  assert.equal(items[0]?.children?.[0]?.id, "toolu_child");
});

test("composeTimelineItems does not duplicate a tool already present in raw timeline", () => {
  const rawTimelineItems: TimelineItem[] = [
    {
      type: "tool",
      id: "toolu_read_1",
      toolName: "Read",
      params: JSON.stringify({ file_path: "src/app.tsx" }),
      progressStatus: "in_progress",
    },
  ];

  const toolDetails: ToolDetail[] = [
    {
      id: "toolu_read_1",
      toolName: "Read",
      params: JSON.stringify({ file_path: "src/app.tsx" }),
      response: "ok",
      progressStatus: "completed",
    },
  ];

  const items = composeTimelineItems({
    rawTimelineItems,
    reasoningText: "",
    toolDetails,
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.type, "tool");
  assert.equal(items[0]?.id, "toolu_read_1");
  assert.equal(items[0]?.response, "ok");
});

test("composeTimelineItems does not duplicate root tool when parent agent id arrives later", () => {
  const rawTimelineItems: TimelineItem[] = [
    {
      type: "agent",
      id: "toolu_agent",
      agentType: "default",
      children: [],
    },
    {
      type: "tool",
      id: "toolu_child",
      toolName: "Read",
      params: JSON.stringify({ file_path: "src/app.tsx" }),
      progressStatus: "in_progress",
    },
  ];

  const toolDetails: ToolDetail[] = [
    {
      id: "toolu_child",
      toolName: "Read",
      params: JSON.stringify({ file_path: "src/app.tsx" }),
      response: "ok",
      parentAgentToolUseId: "toolu_agent",
      progressStatus: "completed",
    },
  ];

  const items = composeTimelineItems({
    rawTimelineItems,
    reasoningText: "",
    toolDetails,
  });

  assert.equal(items.length, 2);
  const rootTools = items.filter((item) => item.type === "tool");
  assert.equal(rootTools.length, 1);
  assert.equal(rootTools[0]?.id, "toolu_child");
});
