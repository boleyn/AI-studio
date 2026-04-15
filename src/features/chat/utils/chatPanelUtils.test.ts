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
        responseData: [
          {
            toolRes: {
              interaction: {
                type: "plan_progress",
                requestId: "r-1",
                payload: {
                  explanation: "rebuilt",
                  plan: [{ step: "A", status: "completed" }],
                },
              },
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
        responseData: [
          {
            toolRes: {
              interaction: {
                type: "plan_progress",
                requestId: "r-2",
                payload: {
                  explanation: "rebuilt",
                  plan: [{ step: "B", status: "pending" }],
                },
              },
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
