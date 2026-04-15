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

test("derivePlanModeFromMessages follows approved enter/exit responses", () => {
  const plan = derivePlanModeFromMessages([
    {
      role: "user",
      content: "",
      additional_kwargs: {
        planModeApprovalResponse: { action: "enter", decision: "approve" },
      },
    } as any,
  ]);
  assert.equal(plan, "plan");

  const backToDefault = derivePlanModeFromMessages([
    {
      role: "user",
      content: "",
      additional_kwargs: {
        planModeApprovalResponse: { action: "enter", decision: "approve" },
      },
    } as any,
    {
      role: "user",
      content: "",
      additional_kwargs: {
        planModeApprovalResponse: { action: "exit", decision: "approve" },
      },
    } as any,
  ]);
  assert.equal(backToDefault, "default");
});
