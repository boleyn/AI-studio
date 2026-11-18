import { defineTool } from "../types";

/**
 * 规划/交互类工具（Hermes todo_tool + clarify_tool）。
 * 名称与前端渲染保持兼容：TodoWrite / update_plan / AskUserQuestion / ExitPlanMode。
 */

type PlanStatus = "pending" | "in_progress" | "completed";
const toStatus = (value: unknown): PlanStatus =>
  value === "completed" ? "completed" : value === "in_progress" ? "in_progress" : "pending";

const emitPlanProgress = (
  emit: import("../types").ToolEventEmitter,
  requestId: string,
  plan: Array<{ step: string; status: PlanStatus }>,
  explanation?: string,
) => {
  if (plan.length === 0) return;
  emit("control", {
    interaction: {
      type: "plan_progress",
      requestId,
      payload: { ...(explanation ? { explanation } : {}), plan },
    },
  });
};

export const TodoWriteTool = defineTool<{ todos: Array<{ content?: string; status?: string; activeForm?: string }> }>({
  name: "TodoWrite",
  toolset: "planning",
  readOnly: true,
  description:
    "Create/update the task list for the current session. Send the full list each time. Keep exactly one item in_progress while working.",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            activeForm: { type: "string" },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
  },
  async handler(input, { emit, toolUseId }) {
    const todos = (Array.isArray(input.todos) ? input.todos : [])
      .map((t) => ({ step: String(t?.content || "").trim(), status: toStatus(t?.status) }))
      .filter((t) => t.step);
    emitPlanProgress(emit, toolUseId, todos);
    const done = todos.filter((t) => t.status === "completed").length;
    return { content: `Todo list updated (${done}/${todos.length} completed). Continue with the next task.` };
  },
});

export const updatePlanTool = defineTool<{ plan: Array<{ step?: string; status?: string }>; explanation?: string }>({
  name: "update_plan",
  toolset: "planning",
  readOnly: true,
  description: "Update the visible execution plan. Each step has a status: pending, in_progress or completed.",
  parameters: {
    type: "object",
    properties: {
      explanation: { type: "string" },
      plan: {
        type: "array",
        items: {
          type: "object",
          properties: { step: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed"] } },
          required: ["step", "status"],
        },
      },
    },
    required: ["plan"],
  },
  async handler(input, { emit, toolUseId }) {
    const plan = (Array.isArray(input.plan) ? input.plan : [])
      .map((item) => ({ step: String(item?.step || "").trim(), status: toStatus(item?.status) }))
      .filter((item) => item.step);
    emitPlanProgress(emit, toolUseId, plan, typeof input.explanation === "string" ? input.explanation.trim() : undefined);
    return { content: "Plan updated." };
  },
});

type Question = { id?: string; question?: string; header?: string; options?: Array<{ label?: string; description?: string }> };

const normalizeQuestions = (raw: unknown) =>
  (Array.isArray(raw) ? (raw as Question[]) : [])
    .filter((q) => q && typeof q === "object")
    .map((q, index) => {
      const options = (Array.isArray(q.options) ? q.options : [])
        .map((o) => ({
          label: typeof o?.label === "string" ? o.label : "",
          ...(typeof o?.description === "string" ? { description: o.description } : {}),
        }))
        .filter((o) => o.label.trim());
      return {
        id: typeof q.id === "string" && q.id.trim() ? q.id.trim() : `q_${index + 1}`,
        question: typeof q.question === "string" ? q.question : "",
        ...(typeof q.header === "string" && q.header.trim() ? { header: q.header.trim() } : {}),
        ...(options.length ? { options } : {}),
      };
    })
    .filter((q) => q.question.trim());

export const AskUserQuestionTool = defineTool<{ questions: Question[] }>({
  name: "AskUserQuestion",
  toolset: "planning",
  readOnly: true,
  description:
    "Ask the user one or more clarifying questions (optionally with multiple-choice options) and wait for the answers. Use only when truly blocked by ambiguity.",
  parameters: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            header: { type: "string" },
            question: { type: "string" },
            options: {
              type: "array",
              items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label"] },
            },
          },
          required: ["question"],
        },
      },
    },
    required: ["questions"],
  },
  async handler(input, { emit, toolUseId, requestInteraction }) {
    const questions = normalizeQuestions(input.questions);
    if (questions.length === 0) return { content: "questions must contain at least one question", isError: true };
    emit("control", { interaction: { type: "plan_question", requestId: toolUseId, payload: { questions } } });
    const decision = await requestInteraction("plan_question", { questions });
    if (!decision) return { content: "User interaction was cancelled before a response was received.", isError: true };
    if (decision.decision === "reject") return { content: decision.note || "User declined to answer the questions.", isError: true };
    const updated = decision.updatedInput as { answers?: Record<string, string> } | undefined;
    const answers = decision.answers || updated?.answers || {};
    const answerText = Object.entries(answers)
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => `"${k}"="${String(v).trim()}"`)
      .join(", ");
    return {
      content: answerText
        ? `User has answered your questions: ${answerText}. You can now continue with the user's answers in mind.`
        : "User acknowledged the questions without a specific answer.",
    };
  },
});

export const ExitPlanModeTool = defineTool<{ plan?: string }>({
  name: "ExitPlanMode",
  toolset: "planning",
  readOnly: true,
  description:
    "In plan mode: present the finished plan to the user and ask for approval to start implementing. Only call when the plan is complete.",
  parameters: {
    type: "object",
    properties: { plan: { type: "string", description: "The plan in markdown" } },
    required: ["plan"],
  },
  async handler(input, { emit, toolUseId, requestInteraction }) {
    const plan = typeof input.plan === "string" ? input.plan.trim() : "";
    const payload = { action: "exit", title: "计划已完成，是否进入执行？", ...(plan ? { description: plan.slice(0, 1200) } : {}) };
    emit("control", { interaction: { type: "plan_approval", requestId: toolUseId, payload } });
    const decision = await requestInteraction("plan_approval", { plan });
    if (!decision) return { content: "User interaction was cancelled before a response was received.", isError: true };
    if (decision.decision === "reject") {
      return { content: decision.note || "User rejected the current plan. Refine your plan and ask again.", isError: true };
    }
    return { content: "User has approved your plan. You can now start coding." };
  },
});
