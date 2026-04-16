import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeHistoryMessagesForTimeline } from "./chatPanelUtils";

test("normalizeHistoryMessagesForTimeline does not overwrite persisted planProgress", () => {
  const input = [
    {
      role: "assistant" as const,
      id: "a-1",
      content: "计划中",
      additional_kwargs: {
        planProgress: {
          explanation: "persisted",
          plan: [{ step: "A", status: "in_progress" }],
        },
        controlEvents: [
          {
            type: "plan_progress",
            requestId: "r-1",
            payload: {
              explanation: "rebuilt",
              plan: [{ step: "A", status: "completed" }],
            },
          },
        ],
      },
    },
  ];

  const normalized = normalizeHistoryMessagesForTimeline(input as any);
  const kwargs = normalized[0].additional_kwargs as Record<string, unknown>;
  const planProgress = kwargs.planProgress as { explanation?: string; plan?: Array<{ status?: string }> };
  assert.equal(planProgress.explanation, "persisted");
  assert.equal(planProgress.plan?.[0]?.status, "in_progress");
});

test("normalizeHistoryMessagesForTimeline backfills planProgress only when missing", () => {
  const input = [
    {
      role: "assistant" as const,
      id: "a-2",
      content: "计划中",
      additional_kwargs: {
        controlEvents: [
          {
            type: "plan_progress",
            requestId: "r-2",
            payload: {
              explanation: "rebuilt",
              plan: [{ step: "B", status: "pending" }],
            },
          },
        ],
      },
    },
  ];

  const normalized = normalizeHistoryMessagesForTimeline(input as any);
  const kwargs = normalized[0].additional_kwargs as Record<string, unknown>;
  const planProgress = kwargs.planProgress as { explanation?: string; plan?: Array<{ step?: string }> };
  assert.equal(planProgress.explanation, "rebuilt");
  assert.equal(planProgress.plan?.[0]?.step, "B");
});

test("normalizeHistoryMessagesForTimeline replays hidden question response by matching controlEvents", () => {
  const input = [
    {
      role: "assistant" as const,
      id: "a-3",
      content: "请确认",
      additional_kwargs: {
        controlEvents: [
          {
            type: "plan_question",
            requestId: "req-1",
            payload: {
              questions: [
                {
                  id: "q1",
                  question: "是否继续",
                  options: [{ label: "确认执行" }],
                },
              ],
            },
          },
        ],
      },
    },
    {
      role: "user" as const,
      id: "u-3",
      content: "确认",
      time: "2026-01-01T00:00:00.000Z",
      additional_kwargs: {
        hiddenFromTimeline: true,
        planQuestionResponse: {
          requestId: "req-1",
          answers: {
            q1: "确认执行",
          },
        },
      },
    },
  ];

  const normalized = normalizeHistoryMessagesForTimeline(input as any);
  const kwargs = normalized[0].additional_kwargs as Record<string, unknown>;
  const planAnswers = kwargs.planAnswers as Record<string, string>;
  assert.equal(planAnswers.q1, "确认执行");
  const submission = kwargs.planQuestionSubmission as { requestId?: string };
  assert.equal(submission.requestId, "req-1");
});
