import test from "node:test";
import assert from "node:assert/strict";
import type { ConversationMessage } from "@/types/conversation";
import { derivePlanResumeState } from "./planResume";

test("derivePlanResumeState returns visible for pending plan question", () => {
  const messages = [
    {
      role: "assistant",
      id: "a1",
      content: "plan",
      additional_kwargs: {
        planProgress: {
          explanation: "执行计划",
          plan: [
            { step: "step 1", status: "completed" },
            { step: "step 2", status: "pending" },
          ],
        },
        controlEvents: [
          {
            type: "plan_question",
            requestId: "req-1",
            payload: {
              questions: [
                {
                  id: "plan_execute_confirm",
                  question: "是否执行",
                  options: [{ label: "确认执行", description: "继续" }],
                },
              ],
            },
          },
        ],
      },
    } satisfies ConversationMessage,
  ];

  const state = derivePlanResumeState(messages);
  assert.equal(state.visible, true);
  assert.equal(state.messageId, "a1");
  assert.equal(state.totalSteps, 2);
  assert.equal(state.completedSteps, 1);
  assert.equal(state.pendingSteps, 1);
  assert.equal(state.pendingQuestion?.requestId, "req-1");
});

test("derivePlanResumeState hides when all steps completed and no question", () => {
  const messages = [
    {
      role: "assistant",
      id: "a2",
      content: "done",
      additional_kwargs: {
        planProgress: {
          plan: [{ step: "done", status: "completed" }],
        },
      },
    } satisfies ConversationMessage,
  ];

  const state = derivePlanResumeState(messages);
  assert.equal(state.visible, false);
  assert.equal(state.totalSteps, 1);
  assert.equal(state.completedSteps, 1);
  assert.equal(state.pendingSteps, 0);
});
