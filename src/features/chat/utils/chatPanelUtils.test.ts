import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractSelectedFilePathsFromUserContent,
  normalizeAttachmentWorkspacePath,
  normalizeHistoryMessagesForTimeline,
  toUpdatedFilesMap,
} from "./chatPanelUtils";

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

test("normalizeHistoryMessagesForTimeline keeps interaction-state based payload unchanged", () => {
  const input = [
    {
      role: "assistant" as const,
      id: "a-3",
      content: "请确认",
      additional_kwargs: {
        planQuestionSelections: {
          "req-1": {
            q1: "确认执行",
          },
        },
        planModeInteractionState: {
          "req-1": {
            type: "plan_question",
            status: "submitted",
          },
        },
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
  const selections = kwargs.planQuestionSelections as Record<string, Record<string, string>>;
  assert.equal(selections["req-1"]?.q1, "确认执行");
  const interactionState = kwargs.planModeInteractionState as Record<string, { status?: string }>;
  assert.equal(interactionState["req-1"]?.status, "submitted");
});

test("toUpdatedFilesMap normalizes updated file paths to workspace-style absolute paths", () => {
  const result = toUpdatedFilesMap({
    "App.js": { code: "export default function App() { return null; }" },
    "/src/index.ts": { code: "console.log('ok');" },
  });

  assert.ok(result);
  assert.equal(result?.["/App.js"]?.code, "export default function App() { return null; }");
  assert.equal(result?.["/src/index.ts"]?.code, "console.log('ok');");
});

test("normalizeAttachmentWorkspacePath keeps file tags relative to workspace .files", () => {
  assert.equal(
    normalizeAttachmentWorkspacePath(
      "/Users/santain/Desktop/sandpack/examples/nextjs-ai-studio/.files/唐继明_简历.pdf"
    ),
    ".files/唐继明_简历.pdf"
  );
  assert.equal(normalizeAttachmentWorkspacePath("/files/a.txt"), ".files/a.txt");
  assert.equal(normalizeAttachmentWorkspacePath("/.files/a.txt"), ".files/a.txt");
  assert.equal(normalizeAttachmentWorkspacePath(".files/a.txt"), ".files/a.txt");
});

test("extractSelectedFilePathsFromUserContent parses FILETAG markers", () => {
  const content = [
    "[唐继明_简历.pdf](FILETAG:.files%2F%E5%94%90%E7%BB%A7%E6%98%8E_%E7%AE%80%E5%8E%86.pdf)",
    "[a.txt](FILETAG:%2Ffiles%2Fa.txt)",
  ].join("\n");
  const selected = extractSelectedFilePathsFromUserContent(content);
  assert.deepEqual(selected, [".files/唐继明_简历.pdf", ".files/a.txt"]);
});
