import type { AgentToolDefinition } from "./types";
import { randomUUID } from "node:crypto";
import type {
  PlanInteractionEnvelope,
  PlanProgressInteractionPayload,
  PlanQuestionInteractionPayload,
} from "@shared/chat/planInteraction";

type PlanItem = {
  step: string;
  status: "pending" | "in_progress" | "completed";
};

const toString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeStatus = (value: unknown): PlanItem["status"] => {
  const raw = toString(value).toLowerCase();
  if (raw === "completed") return "completed";
  if (raw === "in_progress") return "in_progress";
  return "pending";
};

const createRequestId = (prefix: string) => `${prefix}_${randomUUID()}`;

export const createPlanModeTools = (): AgentToolDefinition[] => [
  {
    name: "update_plan",
    description:
      "Update the working plan with current statuses. Use this in plan mode to maintain explicit step tracking.",
    parameters: {
      type: "object",
      properties: {
        explanation: { type: "string" },
        plan: {
          type: "array",
          items: {
            type: "object",
            properties: {
              step: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            },
            required: ["step", "status"],
          },
        },
      },
      required: ["plan"],
    },
    run: async (input) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const rawPlan = Array.isArray(payload.plan) ? payload.plan : [];
      const plan: PlanItem[] = rawPlan
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({
          step: toString(item.step),
          status: normalizeStatus(item.status),
        }))
        .filter((item) => item.step.length > 0);
      if (plan.length === 0) {
        throw new Error("update_plan requires at least one valid plan item");
      }
      const inProgressCount = plan.filter((item) => item.status === "in_progress").length;
      if (inProgressCount > 1) {
        throw new Error("Only one plan step can be in_progress");
      }
      const interaction: PlanInteractionEnvelope<"plan_progress"> = {
        type: "plan_progress",
        requestId: createRequestId("plan_progress"),
        payload: {
          explanation: toString(payload.explanation) || undefined,
          plan,
        } satisfies PlanProgressInteractionPayload,
      };
      return {
        ok: true,
        interaction,
        planModeProtocolVersion: 2,
        ...interaction.payload,
      };
    },
  },
  {
    name: "request_user_input",
    description:
      "Request concise user confirmation or selection during plan mode. Use 1-3 short questions.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              header: { type: "string" },
              id: { type: "string" },
              question: { type: "string" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["label", "description"],
                },
              },
            },
            required: ["id", "question"],
          },
        },
      },
      required: ["questions"],
    },
    run: async (input) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const questions = Array.isArray(payload.questions)
        ? payload.questions
            .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
            .map((item) => ({
              header: toString(item.header) || "Confirm",
              id: toString(item.id),
              question: toString(item.question),
              options: Array.isArray(item.options)
                ? item.options
                    .filter((opt): opt is Record<string, unknown> => Boolean(opt && typeof opt === "object"))
                    .map((opt) => ({
                      label: toString(opt.label),
                      description: toString(opt.description),
                    }))
                    .filter((opt) => opt.label && opt.description)
                : [],
            }))
            .filter((item) => item.id && item.question)
            .slice(0, 3)
        : [];
      if (questions.length === 0) {
        throw new Error("request_user_input requires at least one valid question");
      }
      const interaction: PlanInteractionEnvelope<"plan_question"> = {
        type: "plan_question",
        requestId: createRequestId("plan_question"),
        payload: {
          questions,
        } satisfies PlanQuestionInteractionPayload,
      };
      return {
        ok: true,
        requiresUserInput: true,
        interaction,
        planModeProtocolVersion: 2,
        ...interaction.payload,
      };
    },
  },
];
