import type { ConversationMessage } from "@/types/conversation";
import { getPlanProgressFromMessage, type PlanProgressPayload } from "./planModeDisplay";

export type PlanResumeQuestion = {
  requestId: string;
  questionId: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
};

export type PlanResumeState = {
  visible: boolean;
  messageId?: string;
  explanation?: string;
  totalSteps: number;
  completedSteps: number;
  inProgressSteps: number;
  pendingSteps: number;
  steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>;
  pendingQuestion?: PlanResumeQuestion;
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parsePendingQuestion = (kwargs: Record<string, unknown>): PlanResumeQuestion | undefined => {
  const list = Array.isArray(kwargs.planQuestions) ? kwargs.planQuestions : [];
  if (list.length === 0) return undefined;

  const first = toRecord(list[0]);
  if (!first) return undefined;

  const requestId = typeof first.requestId === "string" ? first.requestId : "";
  const questionId = typeof first.id === "string" ? first.id : "";
  const question = typeof first.question === "string" ? first.question : "";
  const rawOptions = Array.isArray(first.options) ? first.options : [];
  const options = rawOptions
    .map((item) => {
      const option = toRecord(item);
      if (!option) return null;
      const label = typeof option.label === "string" ? option.label : "";
      if (!label.trim()) return null;
      return {
        label,
        ...(typeof option.description === "string" && option.description.trim()
          ? { description: option.description }
          : {}),
      };
    })
    .filter((item): item is { label: string; description?: string } => Boolean(item));

  if (!requestId || !questionId || !question) return undefined;
  return {
    requestId,
    questionId,
    question,
    options,
  };
};

const summarizePlanProgress = (payload: PlanProgressPayload) => {
  const totalSteps = payload.plan.length;
  const completedSteps = payload.plan.filter((item) => item.status === "completed").length;
  const inProgressSteps = payload.plan.filter((item) => item.status === "in_progress").length;
  const pendingSteps = Math.max(0, totalSteps - completedSteps - inProgressSteps);

  return {
    totalSteps,
    completedSteps,
    inProgressSteps,
    pendingSteps,
  };
};

export const derivePlanResumeState = (messages: ConversationMessage[]): PlanResumeState => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "assistant") continue;

    const kwargs = toRecord(message.additional_kwargs);
    if (!kwargs) continue;

    const progress = getPlanProgressFromMessage(message);
    const pendingQuestion = parsePendingQuestion(kwargs);

    if (!progress && !pendingQuestion) continue;

    const summary = progress
      ? summarizePlanProgress(progress)
      : {
          totalSteps: 0,
          completedSteps: 0,
          inProgressSteps: 0,
          pendingSteps: 0,
        };

    const hasResumeValue =
      Boolean(pendingQuestion) || summary.inProgressSteps > 0 || summary.pendingSteps > 0;

    return {
      visible: hasResumeValue,
      ...(message.id ? { messageId: message.id } : {}),
      ...(progress?.explanation ? { explanation: progress.explanation } : {}),
      ...summary,
      steps: progress?.plan || [],
      ...(pendingQuestion ? { pendingQuestion } : {}),
    };
  }

  return {
    visible: false,
    totalSteps: 0,
    completedSteps: 0,
    inProgressSteps: 0,
    pendingSteps: 0,
    steps: [],
  };
};
