export interface ToolStreamPayload {
  id?: string;
  toolName?: string;
  params?: string;
  response?: string;
  rawResponse?: string;
}

export interface ReasoningStreamPayload {
  reasoningText?: string;
}

export interface AgentDurationPayload {
  durationSeconds?: number;
}

export type AgentTaskSnapshot = {
  id: string;
  name?: string;
  status: "running" | "completed" | "failed" | "closed";
  turns?: number;
  queueLength?: number;
  error?: string;
  lastOutput?: string;
  updatedAt?: number;
  isolation?: "session" | "worktree";
  cwd?: string;
  worktreePath?: string;
  requiredMcpServers?: string[];
  outputFile?: string;
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

export type PermissionApprovalPayload = {
  toolName: string;
  reason?: string;
};

export type SessionTaskSnapshot = {
  id: string;
  subject: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "blocked" | "deleted" | "stopped";
  owner?: string;
  createdAt?: number;
  updatedAt?: number;
};

export const AGENT_STATUS_META: Record<
  AgentTaskSnapshot["status"],
  { label: string; bg: string; color: string; borderColor: string }
> = {
  running: {
    label: "运行中",
    bg: "green.50",
    color: "green.700",
    borderColor: "green.200",
  },
  completed: {
    label: "已完成",
    bg: "blue.50",
    color: "blue.700",
    borderColor: "blue.200",
  },
  failed: {
    label: "失败",
    bg: "red.50",
    color: "red.700",
    borderColor: "red.200",
  },
  closed: {
    label: "已关闭",
    bg: "myGray.100",
    color: "myGray.700",
    borderColor: "myGray.250",
  },
};

export const SESSION_TASK_STATUS_META: Record<
  SessionTaskSnapshot["status"],
  { label: string; bg: string; color: string; borderColor: string }
> = {
  pending: { label: "待处理", bg: "myGray.100", color: "myGray.700", borderColor: "myGray.250" },
  in_progress: { label: "进行中", bg: "green.50", color: "green.700", borderColor: "green.200" },
  completed: { label: "已完成", bg: "blue.50", color: "blue.700", borderColor: "blue.200" },
  blocked: { label: "阻塞", bg: "orange.50", color: "orange.700", borderColor: "orange.200" },
  deleted: { label: "已删除", bg: "myGray.100", color: "myGray.700", borderColor: "myGray.250" },
  stopped: { label: "已停止", bg: "red.50", color: "red.700", borderColor: "red.200" },
};

