import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeAssistantAdditionalKwargs,
  resolveAssistantContentForPersistence,
} from "./persistenceMerge";

test("mergeAssistantAdditionalKwargs keeps existing interaction state while merging incoming tool/runtime fields", () => {
  const existing = {
    planQuestions: [
      {
        id: "plan_execute_confirm",
        requestId: "req-1",
        question: "是否执行",
      },
    ],
    planQuestionSubmission: {
      requestId: "req-1",
      answers: { plan_execute_confirm: "确认执行" },
    },
    planModeInteractionState: {
      "req-1": { type: "plan_progress", status: "pending" },
    },
    agentTasks: [{ id: "agent-1", status: "running", turns: 1 }],
    toolDetails: [
      {
        id: "tool-1",
        toolName: "spawn_agent",
        params: "{\"prompt\":\"a\"}",
        response: "{\"id\":\"agent-1\"}",
      },
    ],
    timeline: [
      {
        type: "tool",
        id: "tool-1",
        toolName: "spawn_agent",
        params: "{\"prompt\":\"a\"}",
        response: "",
      },
    ],
  };

  const incoming = {
    planModeState: true,
    executionDelegationMode: "subagent",
    agentTasks: [{ id: "agent-1", status: "completed", turns: 2 }],
    toolDetails: [
      {
        id: "tool-1",
        toolName: "spawn_agent",
        params: "{\"prompt\":\"a\"}",
        response: "{\"id\":\"agent-1\",\"status\":\"completed\"}",
      },
    ],
    timeline: [
      {
        type: "tool",
        id: "tool-1",
        toolName: "spawn_agent",
        params: "{\"prompt\":\"a\"}",
        response: "{\"id\":\"agent-1\",\"status\":\"completed\"}",
      },
    ],
    responseData: [{ nodeId: "tool:spawn_agent", moduleName: "spawn_agent", runningTime: 0.3 }],
  };

  const merged = mergeAssistantAdditionalKwargs({ existing, incoming }) as Record<string, unknown>;

  assert.equal((merged.executionDelegationMode as string) || "", "subagent");
  assert.equal(
    Array.isArray(merged.planQuestions) && merged.planQuestions.length > 0,
    true,
    "existing plan questions should be kept when incoming does not explicitly clear them"
  );
  assert.equal(
    Boolean((merged.planQuestionSubmission as { requestId?: string })?.requestId),
    true,
    "existing plan submission should be preserved"
  );
  assert.equal(
    (merged.planModeInteractionState as Record<string, unknown>)?.["req-1"] != null,
    true,
    "existing interaction state should survive"
  );

  const agentTasks = Array.isArray(merged.agentTasks) ? merged.agentTasks : [];
  assert.equal(agentTasks.length, 1);
  assert.equal((agentTasks[0] as { status?: string }).status, "completed");

  const toolDetails = Array.isArray(merged.toolDetails) ? merged.toolDetails : [];
  assert.equal(toolDetails.length, 1);
  assert.match(
    String((toolDetails[0] as { response?: string }).response || ""),
    /completed/
  );
});

test("resolveAssistantContentForPersistence falls back to existing content when generated/final are empty", () => {
  const resolved = resolveAssistantContentForPersistence({
    generatedContent: "",
    resolvedFinalMessage: "",
    existingMessage: { content: "历史已有内容" },
  });
  assert.equal(resolved, "历史已有内容");
});
