import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage } from "@/types/conversation";
import { getTimelineItems } from "./chatItemParsers";

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
