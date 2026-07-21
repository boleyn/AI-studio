import assert from "node:assert/strict";
import { test } from "node:test";
import { isPlanInteractionEnvelope } from "./planInteraction";

test("isPlanInteractionEnvelope accepts valid payload", () => {
  assert.equal(
    isPlanInteractionEnvelope({
      type: "plan_question",
      requestId: "plan_question_123",
      payload: {
        questions: [{ id: "q1", question: "Pick one", options: [{ label: "A", description: "d" }] }],
      },
    }),
    true
  );
});

test("isPlanInteractionEnvelope rejects malformed payload", () => {
  assert.equal(
    isPlanInteractionEnvelope({
      type: "plan_question",
      requestId: "",
      payload: {},
    }),
    false
  );
  assert.equal(
    isPlanInteractionEnvelope({
      type: "unknown",
      requestId: "id",
      payload: {},
    }),
    false
  );
});

