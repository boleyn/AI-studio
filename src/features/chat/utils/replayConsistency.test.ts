import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeAssistantAdditionalKwargs } from "@/pages/api/chat/completions/persistenceMerge";
import { normalizeHistoryMessagesForTimeline } from "./chatPanelUtils";
import { derivePlanModeFromMessages } from "./planModeDisplay";

test("replay consistency: stream-state survives persistence merge and history normalize", () => {
  // 1) Simulate assistant state built during SSE stream.
  const streamAccumulatedKwargs = {
    planModeState: true,
    toolDetails: [
      {
        id: "tool_spawn_1",
        toolName: "spawn_agent",
        params: "{\"prompt\":\"implement\"}",
        response: "{\"id\":\"agent-1\",\"status\":\"running\"}",
      },
    ],
    timeline: [
      {
        type: "tool",
        id: "tool_spawn_1",
        toolName: "spawn_agent",
        params: "{\"prompt\":\"implement\"}",
        response: "{\"id\":\"agent-1\",\"status\":\"running\"}",
      },
    ],
    responseData: [
      {
        nodeId: "tool:spawn_agent",
        moduleName: "spawn_agent",
        toolRes: { id: "agent-1", status: "running" },
      },
    ],
    agentTasks: [{ id: "agent-1", status: "running", turns: 1 }],
    planModeInteractionState: {
      "plan_q_1": { type: "plan_question", status: "pending" },
    },
    planQuestions: [
      {
        requestId: "plan_q_1",
        id: "plan_execute_confirm",
        header: "执行确认",
        question: "是否执行完整计划？",
        options: [{ label: "确认执行" }],
      },
    ],
  };

  // 2) Simulate backend's final round payload (often partial and easy to override old fields).
  const backendFinalKwargs = {
    planModeState: true,
    executionDelegationMode: "subagent",
    toolDetails: [
      {
        id: "tool_spawn_1",
        toolName: "spawn_agent",
        params: "{\"prompt\":\"implement\"}",
        response: "{\"id\":\"agent-1\",\"status\":\"completed\"}",
      },
    ],
    timeline: [
      {
        type: "tool",
        id: "tool_spawn_1",
        toolName: "spawn_agent",
        params: "{\"prompt\":\"implement\"}",
        response: "{\"id\":\"agent-1\",\"status\":\"completed\"}",
      },
    ],
    agentTasks: [{ id: "agent-1", status: "completed", turns: 2 }],
    responseData: [
      {
        nodeId: "tool:spawn_agent",
        moduleName: "spawn_agent",
        toolRes: { id: "agent-1", status: "completed" },
      },
    ],
  };

  const persistedKwargs = mergeAssistantAdditionalKwargs({
    existing: streamAccumulatedKwargs,
    incoming: backendFinalKwargs,
  }) as Record<string, unknown>;

  // 3) Build persisted message list and simulate hidden user interaction response.
  const conversation = normalizeHistoryMessagesForTimeline([
    {
      role: "assistant",
      id: "assistant-1",
      content: "计划已生成，等待确认",
      additional_kwargs: persistedKwargs,
    } as any,
    {
      role: "user",
      id: "hidden-1",
      content: "",
      additional_kwargs: {
        hiddenFromTimeline: true,
        planQuestionResponse: {
          requestId: "plan_q_1",
          answers: {
            plan_execute_confirm: "确认执行",
          },
        },
      },
    } as any,
  ]);

  const assistant = conversation[0] as any;
  const kwargs = (assistant.additional_kwargs || {}) as Record<string, unknown>;

  // 4) Assert key invariants after replay.
  const toolDetails = Array.isArray(kwargs.toolDetails) ? kwargs.toolDetails : [];
  assert.equal(toolDetails.length, 1);
  assert.match(String((toolDetails[0] as any).response || ""), /completed/);

  const tasks = Array.isArray(kwargs.agentTasks) ? kwargs.agentTasks : [];
  assert.equal(tasks.length, 1);
  assert.equal((tasks[0] as any).status, "completed");

  const planAnswers = (kwargs.planAnswers || {}) as Record<string, string>;
  assert.equal(planAnswers.plan_execute_confirm, "确认执行");

  const submission = (kwargs.planQuestionSubmission || null) as { requestId?: string } | null;
  assert.equal(submission?.requestId, "plan_q_1");

  // Approval not yet explicitly exited -> still in plan mode.
  assert.equal(derivePlanModeFromMessages(conversation as any), "plan");
});

test("replay consistency: approved exit should switch history mode to default", () => {
  const mode = derivePlanModeFromMessages([
    {
      role: "assistant",
      content: "",
      additional_kwargs: { planModeState: true },
    } as any,
    {
      role: "user",
      content: "",
      additional_kwargs: {
        planModeApprovalResponse: { action: "exit", decision: "approve" },
      },
    } as any,
  ]);
  assert.equal(mode, "default");
});
