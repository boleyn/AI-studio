import type { ConversationMessage } from "@/types/conversation";

export type PlanApprovalDecision = "approve" | "reject" | "";

export type PlanApprovalOption = {
  label: string;
  value: "approve" | "reject";
};

export type PlanModeApprovalPayload = {
  requestId?: string;
  action: "enter" | "exit";
  title?: string;
  description?: string;
  rationale?: string;
  options?: PlanApprovalOption[];
};

export type PlanProgressItem = {
  step: string;
  status: "pending" | "in_progress" | "completed";
};

export type PlanProgressPayload = {
  explanation?: string;
  plan: PlanProgressItem[];
};

const normalizeChecklistLine = (value: string) =>
  value
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+\s*[).、:：）-]\s*/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .trim();

export const parseChecklistItems = (source?: string) => {
  if (!source || !source.trim()) return [] as string[];
  const normalized = source.replace(/\r/g, "\n").trim();
  const byLine = normalized
    .split(/\n+/)
    .map((line) => normalizeChecklistLine(line))
    .filter(Boolean);

  const numberedChunks = normalized
    .split(/(?=(?:^|\s)\d+\s*[).、:：）-]\s*)/g)
    .map((line) => normalizeChecklistLine(line))
    .filter(Boolean)
    .filter((line) => /\s/.test(line) || line.length > 1);

  const markdownChecklist = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\[[ xX]\]\s+/.test(line))
    .map((line) => normalizeChecklistLine(line))
    .filter(Boolean);

  const raw =
    markdownChecklist.length > 0 ? markdownChecklist : numberedChunks.length > 1 ? numberedChunks : byLine;

  return raw.filter((line, index, list) => list.indexOf(line) === index).slice(0, 12);
};

export const getPlanModeApprovalFromMessage = (message: ConversationMessage): PlanModeApprovalPayload | null => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return null;
  const value = (message.additional_kwargs as { planModeApproval?: unknown }).planModeApproval;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const action = raw.action === "exit" ? "exit" : raw.action === "enter" ? "enter" : null;
  if (!action) return null;

  const options = Array.isArray(raw.options)
    ? raw.options
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({
          label: typeof item.label === "string" ? item.label : "",
          value: item.value === "reject" ? ("reject" as const) : ("approve" as const),
        }))
        .filter((item) => item.label.trim().length > 0)
    : undefined;

  return {
    ...(typeof raw.requestId === "string" && raw.requestId.trim() ? { requestId: raw.requestId.trim() } : {}),
    action,
    ...(typeof raw.title === "string" ? { title: raw.title } : {}),
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    ...(typeof raw.rationale === "string" ? { rationale: raw.rationale } : {}),
    ...(options && options.length > 0 ? { options } : {}),
  };
};

export const getPlanProgressFromMessage = (message: ConversationMessage): PlanProgressPayload | null => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return null;
  const value = (message.additional_kwargs as { planProgress?: unknown }).planProgress;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const plan = Array.isArray(raw.plan)
    ? raw.plan
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({
          step: typeof item.step === "string" ? item.step.trim() : "",
          status:
            item.status === "completed"
              ? ("completed" as const)
              : item.status === "in_progress"
              ? ("in_progress" as const)
              : ("pending" as const),
        }))
        .filter((item) => item.step.length > 0)
    : [];
  if (plan.length === 0) return null;
  return {
    plan,
    ...(typeof raw.explanation === "string" && raw.explanation.trim()
      ? { explanation: raw.explanation.trim() }
      : {}),
  };
};

export const parseToolPayload = (...candidates: Array<string | undefined>) => {
  for (const value of candidates) {
    if (!value) continue;
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // ignore invalid payload
    }
  }
  return null;
};

export const derivePlanModeFromMessages = (list: ConversationMessage[]): "default" | "plan" => {
  let active = false;
  for (const message of list) {
    const kwargs =
      message.additional_kwargs && typeof message.additional_kwargs === "object"
        ? (message.additional_kwargs as Record<string, unknown>)
        : null;
    if (!kwargs) continue;
    if (typeof kwargs.planModeState === "boolean") {
      active = kwargs.planModeState;
    }
  }
  return active ? "plan" : "default";
};
