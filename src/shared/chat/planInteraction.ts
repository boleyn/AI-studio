export type PlanInteractionType = "plan_approval" | "plan_question" | "plan_progress";

export type PlanApprovalDecision = "approve" | "reject";

export type PlanApprovalOption = {
  label: string;
  value: PlanApprovalDecision;
};

export type PlanApprovalInteractionPayload = {
  action: "enter" | "exit";
  title?: string;
  description?: string;
  rationale?: string;
  options?: PlanApprovalOption[];
};

export type PlanQuestionOption = {
  label: string;
  description?: string;
};

export type PlanQuestion = {
  header?: string;
  id: string;
  question: string;
  options?: PlanQuestionOption[];
};

export type PlanQuestionInteractionPayload = {
  questions: PlanQuestion[];
};

export type PlanProgressItem = {
  step: string;
  status: "pending" | "in_progress" | "completed";
};

export type PlanProgressInteractionPayload = {
  explanation?: string;
  plan: PlanProgressItem[];
};

export type PlanInteractionPayloadByType = {
  plan_approval: PlanApprovalInteractionPayload;
  plan_question: PlanQuestionInteractionPayload;
  plan_progress: PlanProgressInteractionPayload;
};

export type PlanInteractionEnvelope<T extends PlanInteractionType = PlanInteractionType> = {
  type: T;
  requestId: string;
  payload: PlanInteractionPayloadByType[T];
};

export type PlanInteractionResponse = {
  requestId: string;
  decision?: PlanApprovalDecision;
  action?: "enter" | "exit";
  answers?: Record<string, string>;
  note?: string;
};

export const isPlanInteractionEnvelope = (value: unknown): value is PlanInteractionEnvelope => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    record.type !== "plan_approval" &&
    record.type !== "plan_question" &&
    record.type !== "plan_progress"
  ) {
    return false;
  }
  if (typeof record.requestId !== "string" || !record.requestId.trim()) return false;
  return Boolean(record.payload && typeof record.payload === "object" && !Array.isArray(record.payload));
};
