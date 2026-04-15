import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSubAgentTimelineEvents } from "./subAgentTimeline";

test("buildSubAgentTimelineEvents extracts subagent snapshots from spawn_agent response", () => {
  const timeline = [
    {
      type: "tool" as const,
      id: "tool-1",
      toolName: "spawn_agent",
      params: "{\"prompt\":\"fix\"}",
      response: JSON.stringify({
        id: "agent-1",
        status: "running",
        name: "worker-a",
      }),
    },
    {
      type: "tool" as const,
      id: "tool-2",
      toolName: "Read",
      params: "{\"file_path\":\"a\"}",
      response: "ok",
    },
  ];

  const events = buildSubAgentTimelineEvents(timeline);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "tool-1");
  assert.equal(events[0].toolName, "spawn_agent");
  assert.equal(events[0].taskSnapshots.length, 1);
  assert.equal(events[0].taskSnapshots[0].id, "agent-1");
  assert.equal(events[0].taskSnapshots[0].status, "running");
});

test("buildSubAgentTimelineEvents supports list_agents style payload", () => {
  const timeline = [
    {
      type: "tool" as const,
      id: "tool-3",
      toolName: "list_agents",
      params: "{}",
      response: JSON.stringify({
        agents: [
          { id: "agent-1", status: "running" },
          { id: "agent-2", status: "completed" },
        ],
      }),
    },
  ];

  const events = buildSubAgentTimelineEvents(timeline);
  assert.equal(events.length, 1);
  assert.equal(events[0].taskSnapshots.length, 2);
});
