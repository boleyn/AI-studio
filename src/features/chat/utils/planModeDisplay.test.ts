import assert from "node:assert/strict";
import { test } from "node:test";
import { derivePlanModeFromMessages } from "./planModeDisplay";

test("derivePlanModeFromMessages follows explicit planModeState when present", () => {
  const mode = derivePlanModeFromMessages([
    { role: "assistant", content: "", additional_kwargs: { planModeState: true } } as any,
    { role: "assistant", content: "", additional_kwargs: { planModeState: false } } as any,
  ]);
  assert.equal(mode, "default");
});

test("derivePlanModeFromMessages ignores legacy approval-only payload without planModeState", () => {
  const mode = derivePlanModeFromMessages([
    {
      role: "user",
      content: "",
      additional_kwargs: {
        planModeApprovalResponse: { action: "enter", decision: "approve" },
      },
    } as any,
  ]);
  assert.equal(mode, "default");
});
