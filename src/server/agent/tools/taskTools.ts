import {
  createTask,
  getTask,
  listTasks,
  updateTask,
} from "@server/agent/tasks/manager";
import type { AgentToolDefinition } from "./types";

const toString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toStringArray = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => toString(item)).filter(Boolean) : [];

const toMetadata = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const normalizeStatus = (value: unknown) => {
  const raw = toString(value).toLowerCase();
  if (raw === "pending") return "pending" as const;
  if (raw === "in_progress") return "in_progress" as const;
  if (raw === "completed") return "completed" as const;
  if (raw === "blocked") return "blocked" as const;
  if (raw === "deleted") return "deleted" as const;
  if (raw === "stopped") return "stopped" as const;
  return undefined;
};

export const createTaskTools = (sessionId: string): AgentToolDefinition[] => [
  {
    name: "TaskCreate",
    description: "Create a new task item for execution tracking.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string" },
        description: { type: "string" },
        activeForm: { type: "string" },
        owner: { type: "string" },
        metadata: { type: "object" },
      },
      required: ["subject"],
    },
    run: async (input) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const subject = toString(payload.subject);
      if (!subject) throw new Error("TaskCreate: subject is required");
      const task = createTask(sessionId, {
        subject,
        description: toString(payload.description) || undefined,
        activeForm: toString(payload.activeForm) || undefined,
        owner: toString(payload.owner) || undefined,
        metadata: toMetadata(payload.metadata),
      });
      return { ok: true, task };
    },
  },
  {
    name: "TaskGet",
    description: "Get one task item by taskId.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
      },
      required: ["taskId"],
    },
    run: async (input) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const taskId = toString(payload.taskId);
      if (!taskId) throw new Error("TaskGet: taskId is required");
      const task = getTask(sessionId, taskId);
      if (!task) throw new Error(`TaskGet: task not found (${taskId})`);
      return { ok: true, task };
    },
  },
  {
    name: "TaskList",
    description: "List tasks in current session.",
    parameters: {
      type: "object",
      properties: {
        pending: { type: "boolean" },
      },
    },
    run: async (input) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const pendingOnly = payload.pending === true;
      return {
        ok: true,
        tasks: listTasks(sessionId, { pendingOnly }),
      };
    },
  },
  {
    name: "TaskUpdate",
    description: "Update task fields and status.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        subject: { type: "string" },
        description: { type: "string" },
        activeForm: { type: "string" },
        owner: { type: "string" },
        metadata: { type: "object" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "blocked", "deleted", "stopped"],
        },
        addBlocks: { type: "array", items: { type: "string" } },
        addBlockedBy: { type: "array", items: { type: "string" } },
      },
      required: ["taskId"],
    },
    run: async (input) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const taskId = toString(payload.taskId);
      if (!taskId) throw new Error("TaskUpdate: taskId is required");
      const task = updateTask(sessionId, taskId, {
        subject: toString(payload.subject) || undefined,
        description:
          typeof payload.description === "string" ? payload.description : undefined,
        activeForm: toString(payload.activeForm) || undefined,
        owner: toString(payload.owner) || undefined,
        metadata: toMetadata(payload.metadata),
        status: normalizeStatus(payload.status),
        addBlocks: toStringArray(payload.addBlocks),
        addBlockedBy: toStringArray(payload.addBlockedBy),
      });
      if (!task) throw new Error(`TaskUpdate: task not found (${taskId})`);
      return { ok: true, task };
    },
  },
  {
    name: "TaskStop",
    description: "Mark an in-progress task as stopped.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
      },
      required: ["taskId"],
    },
    run: async (input) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const taskId = toString(payload.taskId);
      if (!taskId) throw new Error("TaskStop: taskId is required");
      const task = updateTask(sessionId, taskId, { status: "stopped" });
      if (!task) throw new Error(`TaskStop: task not found (${taskId})`);
      return { ok: true, task };
    },
  },
];

