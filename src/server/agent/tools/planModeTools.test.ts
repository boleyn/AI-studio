import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlanModeTools } from "./planModeTools";

const getTool = (name: string) => {
  const tool = createPlanModeTools().find((item) => item.name === name);
  assert.ok(tool, `tool ${name} should exist`);
  return tool;
};

test("update_plan returns structured plan_progress interaction envelope", async () => {
  const updatePlan = getTool("update_plan");
  const result = (await updatePlan.run({
    explanation: "Sync execution checklist",
    plan: [
      { step: "Audit protocol", status: "completed" },
      { step: "Patch UI", status: "in_progress" },
    ],
  })) as Record<string, unknown>;

  assert.equal(result.ok, true);
  assert.equal(result.planModeProtocolVersion, 2);
  assert.equal((result.interaction as { type?: string }).type, "plan_progress");
  assert.match((result.interaction as { requestId?: string }).requestId || "", /^plan_progress_/);

  const payload = (result.interaction as { payload?: { plan?: Array<{ step: string; status: string }> } })
    .payload;
  assert.equal(payload?.plan?.length, 2);
  assert.deepEqual(payload?.plan?.[0], { step: "Audit protocol", status: "completed" });
});

test("update_plan rejects multiple in_progress items", async () => {
  const updatePlan = getTool("update_plan");
  await assert.rejects(
    () =>
      updatePlan.run({
        plan: [
          { step: "Step A", status: "in_progress" },
          { step: "Step B", status: "in_progress" },
        ],
      }),
    /Only one plan step can be in_progress/
  );
});

test("request_user_input returns structured plan_question interaction envelope", async () => {
  const requestUserInput = getTool("request_user_input");
  const result = (await requestUserInput.run({
    questions: [
      {
        id: "q1",
        question: "Pick strategy",
        options: [{ label: "A", description: "Fast path" }],
      },
      {
        id: "q2",
        question: "Need rollback?",
        options: [{ label: "No", description: "Proceed directly" }],
      },
      {
        id: "q3",
        question: "Notify user?",
        options: [{ label: "Yes", description: "Show progress" }],
      },
      {
        id: "q4",
        question: "Extra question should be trimmed",
        options: [{ label: "Skip", description: "Should not exist" }],
      },
    ],
  })) as Record<string, unknown>;

  assert.equal(result.ok, true);
  assert.equal(result.requiresUserInput, true);
  assert.equal(result.planModeProtocolVersion, 2);
  assert.equal((result.interaction as { type?: string }).type, "plan_question");
  assert.match((result.interaction as { requestId?: string }).requestId || "", /^plan_question_/);

  const payload = (result.interaction as { payload?: { questions?: Array<{ id: string }> } }).payload;
  assert.equal(payload?.questions?.length, 3);
  assert.deepEqual(payload?.questions?.map((item) => item.id), ["q1", "q2", "q3"]);
});

test("request_user_input rejects empty question list", async () => {
  const requestUserInput = getTool("request_user_input");
  await assert.rejects(
    () => requestUserInput.run({ questions: [{ id: "", question: "" }] }),
    /requires at least one valid question/
  );
});

