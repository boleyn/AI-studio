import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlanPermissionTools, derivePlanModeState } from "./planMode";

const getTool = (name: string) => {
  const tool = createPlanPermissionTools().find((item) => item.name === name);
  assert.ok(tool, `tool ${name} should exist`);
  return tool;
};

test("enter_plan_mode returns structured plan_approval interaction envelope", async () => {
  const tool = getTool("enter_plan_mode");
  const result = (await tool.run({ rationale: "Need explicit planning" })) as Record<string, unknown>;

  assert.equal(result.ok, true);
  assert.equal(result.requiresPlanModeApproval, true);
  assert.equal(result.planModeProtocolVersion, 2);
  assert.equal((result.interaction as { type?: string }).type, "plan_approval");
  assert.match((result.interaction as { requestId?: string }).requestId || "", /^plan_approval_/);
  assert.equal(
    ((result.interaction as { payload?: { action?: string } }).payload || {}).action,
    "enter"
  );
});

test("exit_plan_mode returns plan_approval payload with exit action", async () => {
  const tool = getTool("exit_plan_mode");
  const result = (await tool.run({ rationale: "Execute now" })) as Record<string, unknown>;
  const payload = (result.interaction as { payload?: { action?: string } }).payload || {};
  assert.equal(payload.action, "exit");
});

test("derivePlanModeState respects explicit state and approval responses", () => {
  assert.equal(derivePlanModeState([]), false);
  assert.equal(
    derivePlanModeState([{ additional_kwargs: { planModeApprovalResponse: { action: "enter", decision: "approve" } } }]),
    true
  );
  assert.equal(
    derivePlanModeState([
      { additional_kwargs: { planModeApprovalResponse: { action: "enter", decision: "approve" } } },
      { additional_kwargs: { planModeApprovalResponse: { action: "exit", decision: "approve" } } },
    ]),
    false
  );
  assert.equal(
    derivePlanModeState([
      { additional_kwargs: { planModeApprovalResponse: { action: "enter", decision: "approve" } } },
      { additional_kwargs: { planModeState: true } },
    ]),
    true
  );
});

