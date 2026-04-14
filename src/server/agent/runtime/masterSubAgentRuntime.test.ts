import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldStopForToolResponse } from "./masterSubAgentRuntime";

test("shouldStopForToolResponse returns true for permission approval payload", () => {
  const payload = JSON.stringify({
    ok: false,
    requiresPermissionApproval: true,
    permission: { toolName: "Write", reason: "needs approval" },
  });
  assert.equal(shouldStopForToolResponse(payload), true);
});

test("shouldStopForToolResponse returns true for plan mode approval payload", () => {
  const payload = JSON.stringify({
    ok: true,
    requiresPlanModeApproval: true,
  });
  assert.equal(shouldStopForToolResponse(payload), true);
});

test("shouldStopForToolResponse returns false for normal payload", () => {
  const payload = JSON.stringify({ ok: true, result: "done" });
  assert.equal(shouldStopForToolResponse(payload), false);
  assert.equal(shouldStopForToolResponse("not json"), false);
});

test("shouldStopForToolResponse returns true for plan interaction when pause flag is enabled", () => {
  const payload = JSON.stringify({
    ok: true,
    interaction: {
      type: "plan_progress",
      requestId: "plan_progress_123",
      payload: {
        plan: [{ step: "A", status: "pending" }],
      },
    },
  });
  assert.equal(
    shouldStopForToolResponse(payload, {
      pauseOnPlanInteraction: true,
      interactionType: "plan_progress",
    }),
    true
  );
});

test("shouldStopForToolResponse returns false for plan interaction when pause flag is disabled", () => {
  const payload = JSON.stringify({
    ok: true,
    interaction: {
      type: "plan_progress",
      requestId: "plan_progress_123",
      payload: {
        plan: [{ step: "A", status: "pending" }],
      },
    },
  });
  assert.equal(
    shouldStopForToolResponse(payload, {
      pauseOnPlanInteraction: false,
      interactionType: "plan_progress",
    }),
    false
  );
});
