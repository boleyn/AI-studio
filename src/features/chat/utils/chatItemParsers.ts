import type { ConversationMessage } from "@/types/conversation";
import {
  isPlanInteractionEnvelope,
  type PlanInteractionEnvelope,
} from "@shared/chat/planInteraction";

export interface MessageFile {
  id?: string;
  name?: string;
  size?: number;
  type?: string;
  storagePath?: string;
  previewUrl?: string;
  downloadUrl?: string;
  parse?: {
    status?: "success" | "error" | "skipped";
    progress?: number;
    parser?: string;
    error?: string;
  };
}

export interface ToolDetail {
  id?: string;
  toolName?: string;
  params?: string;
  response?: string;
  interaction?: PlanInteractionEnvelope;
  progressStatus?: "pending" | "in_progress" | "completed" | "error";
}

export interface TimelineItem {
  type: "reasoning" | "answer" | "tool";
  text?: string;
  id?: string;
  toolName?: string;
  params?: string;
  response?: string;
  interaction?: PlanInteractionEnvelope;
  progressStatus?: "pending" | "in_progress" | "completed" | "error";
}

export interface PlanQuestionOption {
  label: string;
  description?: string;
}

export interface PlanQuestion {
  requestId?: string;
  header: string;
  id: string;
  question: string;
  options: PlanQuestionOption[];
}

export interface PlanQuestionSubmission {
  requestId?: string;
  answers: Record<string, string>;
  submittedAt?: string;
}

export const MAX_TOOL_DETAIL_CHARS = 800;

export const PLAN_MODE_TOOL_NAMES = new Set([
  "enter_plan_mode",
  "exit_plan_mode",
  "request_user_input",
  "update_plan",
]);

const normalizeToolPayload = (value?: string) => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    return trimmed.replace(/\s+/g, " ");
  }
};

const toStringValue = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getToolFingerprint = (toolName?: string, params?: string, response?: string) => {
  const normalizedName = (toolName || "").trim().toLowerCase();
  const normalizedParams = normalizeToolPayload(params);
  const normalizedResponse = normalizeToolPayload(response);
  return `${normalizedName}::${normalizedParams}::${normalizedResponse}`;
};

export const getMessageFiles = (message: ConversationMessage): MessageFile[] => {
  if (!message.artifact || typeof message.artifact !== "object") return [];
  const files = (message.artifact as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  return files.filter((file): file is MessageFile => Boolean(file && typeof file === "object"));
};

export const isImageFile = (file: MessageFile) => {
  if (typeof file.type === "string" && file.type.startsWith("image/")) return true;
  const name = typeof file.name === "string" ? file.name.toLowerCase() : "";
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"].some((ext) =>
    name.endsWith(ext)
  );
};

export const getToolDetails = (message: ConversationMessage): ToolDetail[] => {
  const sdkContent =
    message.message && typeof message.message === "object"
      ? (message.message as { content?: unknown }).content
      : message.content;
  if (Array.isArray(sdkContent)) {
    const details: ToolDetail[] = [];
    const byId = new Map<string, ToolDetail>();
    for (const block of sdkContent) {
      if (!block || typeof block !== "object") continue;
      const item = block as Record<string, unknown>;
      if (item.type === "tool_use" && typeof item.id === "string") {
        const id = item.id;
        const toolName = typeof item.name === "string" ? item.name : "tool";
        const params =
          item.input && typeof item.input === "object"
            ? JSON.stringify(item.input, null, 2)
            : "";
        const next: ToolDetail = {
          id,
          toolName,
          params,
          response: "",
          progressStatus: "in_progress",
        };
        byId.set(id, next);
        details.push(next);
        continue;
      }
      if (item.type === "tool_result" && typeof item.tool_use_id === "string") {
        const id = item.tool_use_id;
        const target = byId.get(id);
        const response = typeof item.content === "string" ? item.content : toStringValue(item.content);
        const status = item.is_error === true ? "error" : "completed";
        if (target) {
          target.response = response;
          target.progressStatus = status;
        } else {
          details.push({
            id,
            toolName: "tool",
            response,
            progressStatus: status,
          });
        }
      }
    }
    if (details.length > 0) return details;
  }
  return [];
};

export const getReasoningText = (message: ConversationMessage): string => {
  const sdkContent =
    message.message && typeof message.message === "object"
      ? (message.message as { content?: unknown }).content
      : message.content;
  if (Array.isArray(sdkContent)) {
    const text = sdkContent
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const item = block as Record<string, unknown>;
        return item.type === "thinking" && typeof item.thinking === "string" ? item.thinking : "";
      })
      .join("");
    if (text.trim()) return text;
  }

  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return "";
  const kwargs = message.additional_kwargs as {
    reasoning_text?: unknown;
    reasoning_content?: unknown;
  };
  const value = kwargs.reasoning_text ?? kwargs.reasoning_content;
  return typeof value === "string" ? value : "";
};

export const getTimelineItems = (message: ConversationMessage): TimelineItem[] => {
  const sdkContent =
    message.message && typeof message.message === "object"
      ? (message.message as { content?: unknown }).content
      : message.content;
  if (Array.isArray(sdkContent)) {
    const timeline: TimelineItem[] = [];
    const toolIndexById = new Map<string, number>();
    for (const block of sdkContent) {
      if (!block || typeof block !== "object") continue;
      const item = block as Record<string, unknown>;
      if (item.type === "thinking" && typeof item.thinking === "string") {
        timeline.push({ type: "reasoning", text: item.thinking });
        continue;
      }
      if (item.type === "text" && typeof item.text === "string") {
        timeline.push({ type: "answer", text: item.text });
        continue;
      }
      if (item.type === "tool_use" && typeof item.id === "string") {
        const params =
          item.input && typeof item.input === "object"
            ? JSON.stringify(item.input, null, 2)
            : undefined;
        const index = timeline.push({
          type: "tool",
          id: item.id,
          toolName: typeof item.name === "string" ? item.name : "tool",
          params,
          progressStatus: "in_progress",
        }) - 1;
        toolIndexById.set(item.id, index);
        continue;
      }
      if (item.type === "tool_result" && typeof item.tool_use_id === "string") {
        const idx = toolIndexById.get(item.tool_use_id);
        const response = typeof item.content === "string" ? item.content : toStringValue(item.content);
        const status = item.is_error === true ? "error" : "completed";
        if (typeof idx === "number" && timeline[idx]) {
          timeline[idx] = {
            ...timeline[idx],
            response,
            progressStatus: status,
          };
        } else {
          timeline.push({
            type: "tool",
            id: item.tool_use_id,
            toolName: "tool",
            response,
            progressStatus: status,
          });
        }
      }
    }
    if (timeline.length > 0) return timeline;
  }
  return [];
};

export const getPlanQuestions = (message: ConversationMessage): PlanQuestion[] => {
  const controlEvents =
    message.additional_kwargs && typeof message.additional_kwargs === "object"
      ? (message.additional_kwargs as { controlEvents?: unknown }).controlEvents
      : undefined;
  if (Array.isArray(controlEvents)) {
    const questions = controlEvents
      .filter((item): item is PlanInteractionEnvelope => isPlanInteractionEnvelope(item))
      .filter((item) => item.type === "plan_question")
      .flatMap((item) => {
        const payload =
          item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
            ? (item.payload as Record<string, unknown>)
            : null;
        const list = payload && Array.isArray(payload.questions) ? payload.questions : [];
        return list
          .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
          .map((value) => ({
            requestId: item.requestId,
            header: typeof value.header === "string" ? value.header : "确认",
            id: typeof value.id === "string" ? value.id : "",
            question: typeof value.question === "string" ? value.question : "",
            options: Array.isArray(value.options)
              ? value.options
                  .filter((opt): opt is Record<string, unknown> => Boolean(opt && typeof opt === "object"))
                  .map((opt) => ({
                    label: typeof opt.label === "string" ? opt.label : "",
                    description: typeof opt.description === "string" ? opt.description : "",
                  }))
                  .filter((opt) => opt.label.trim().length > 0)
              : [],
          }));
      })
      .filter((item) => item.id && item.question);
    if (questions.length > 0) return questions;
  }

  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return [];
  const raw = (message.additional_kwargs as { planQuestions?: unknown }).planQuestions;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      requestId: typeof item.requestId === "string" ? item.requestId : undefined,
      header: typeof item.header === "string" ? item.header : "确认",
      id: typeof item.id === "string" ? item.id : "",
      question: typeof item.question === "string" ? item.question : "",
      options: Array.isArray(item.options)
        ? item.options
            .filter((opt): opt is Record<string, unknown> => Boolean(opt && typeof opt === "object"))
            .map((opt) => ({
              label: typeof opt.label === "string" ? opt.label : "",
              description: typeof opt.description === "string" ? opt.description : "",
            }))
            .filter((opt) => opt.label.trim().length > 0)
        : [],
    }))
    .filter((item) => item.id && item.question);
};

export const getPlanAnswers = (message: ConversationMessage): Record<string, string> => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return {};
  const raw = (message.additional_kwargs as { planAnswers?: unknown }).planAnswers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === "string" && value.trim()) {
      acc[key] = value;
    }
    return acc;
  }, {});
};

export const getPlanQuestionSubmission = (message: ConversationMessage): PlanQuestionSubmission | null => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return null;
  const raw = (message.additional_kwargs as { planQuestionSubmission?: unknown }).planQuestionSubmission;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const answersRaw =
    record.answers && typeof record.answers === "object" && !Array.isArray(record.answers)
      ? (record.answers as Record<string, unknown>)
      : {};
  const answers = Object.entries(answersRaw).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === "string" && value.trim()) {
      acc[key] = value;
    }
    return acc;
  }, {});
  return {
    requestId: typeof record.requestId === "string" ? record.requestId : undefined,
    answers,
    submittedAt: typeof record.submittedAt === "string" ? record.submittedAt : undefined,
  };
};

export const getPlanModeApprovalDecision = (message: ConversationMessage): "approve" | "reject" | "" => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return "";
  const value = (message.additional_kwargs as { planModeApprovalDecision?: unknown }).planModeApprovalDecision;
  return value === "approve" || value === "reject" ? value : "";
};

export const getPlanPreview = (message: ConversationMessage): string => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return "";
  const value = (message.additional_kwargs as { planPreview?: unknown }).planPreview;
  return typeof value === "string" ? value : "";
};

export const getRunStatus = (
  message: ConversationMessage,
  isStreaming?: boolean
): "running" | "success" | "error" => {
  if (isStreaming) return "running";
  if (message.status === "error") return "error";
  return "success";
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const toValidDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

export const formatExecutionTimeForHeader = (value: unknown): string | null => {
  const d = toValidDate(value);
  if (!d) return null;

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();

  const isSameDay =
    now.getFullYear() === d.getFullYear() && now.getMonth() === d.getMonth() && now.getDate() === d.getDate();

  const formatHMS = (date: Date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  const formatYMD = (date: Date) =>
    `${date.getFullYear()}年${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日`;

  if (diffMs < 0) return formatHMS(d);
  if (diffMs <= 10_000) return "刚刚";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}秒前`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}分钟前`;
  if (isSameDay) return formatHMS(d);
  return formatYMD(d);
};

export const getPathTailLabel = (value: string): string => {
  const normalized = (value || "").replace(/\\/g, "/");
  const base = normalized.split("/").filter(Boolean).pop() || value;
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
};

export const composeTimelineItems = ({
  rawTimelineItems,
  reasoningText,
  toolDetails,
}: {
  rawTimelineItems: TimelineItem[];
  reasoningText: string;
  toolDetails: ToolDetail[];
}): TimelineItem[] => {
  const next: TimelineItem[] = [];

  rawTimelineItems.forEach((item) => {
    if ((item.type === "reasoning" || item.type === "answer") && typeof item.text === "string") {
      const last = next[next.length - 1];
      if (last && last.type === item.type && typeof last.text === "string") {
        next[next.length - 1] = {
          ...last,
          text: `${last.text}${item.text}`,
        };
        return;
      }
      next.push({ ...item });
      return;
    }
    next.push({ ...item });
  });

  const normalizedReasoning = reasoningText.trim();
  const hasReasoningInTimeline = next.some(
    (item) => item.type === "reasoning" && typeof item.text === "string" && item.text.trim().length > 0
  );

  if (!hasReasoningInTimeline && normalizedReasoning) {
    next.unshift({
      type: "reasoning",
      id: "reasoning",
      text: normalizedReasoning,
    });
  }

  if (toolDetails.length === 0) return next;

  const timelineToolIndexById = new Map<string, number>();
  const timelineToolIndexByFingerprint = new Map<string, number>();
  next.forEach((item, index) => {
    if (item.type !== "tool") return;
    timelineToolIndexByFingerprint.set(getToolFingerprint(item.toolName, item.params, item.response), index);
    if (typeof item.id === "string" && item.id) {
      timelineToolIndexById.set(item.id, index);
    }
  });

  toolDetails.forEach((tool) => {
    const toolId = typeof tool.id === "string" && tool.id ? tool.id : undefined;
    const toolFingerprint = getToolFingerprint(tool.toolName, tool.params, tool.response);
    const targetIndexByFingerprint = timelineToolIndexByFingerprint.get(toolFingerprint);
    if (targetIndexByFingerprint !== undefined) {
      const target = next[targetIndexByFingerprint];
      next[targetIndexByFingerprint] = {
        ...target,
        toolName: target.toolName || tool.toolName,
        params: target.params && target.params.length >= (tool.params?.length || 0) ? target.params : tool.params,
        response:
          (target.response?.length || 0) >= (tool.response?.length || 0)
            ? target.response
            : tool.response,
        interaction: target.interaction || tool.interaction,
        progressStatus: target.progressStatus || tool.progressStatus,
      };
      return;
    }

    if (toolId) {
      const targetIndex = timelineToolIndexById.get(toolId);
      if (targetIndex !== undefined) {
        const target = next[targetIndex];
        next[targetIndex] = {
          ...target,
          toolName: target.toolName || tool.toolName,
          params: target.params && target.params.length >= (tool.params?.length || 0) ? target.params : tool.params,
          response:
            (target.response?.length || 0) >= (tool.response?.length || 0)
              ? target.response
              : tool.response,
          interaction: target.interaction || tool.interaction,
          progressStatus: target.progressStatus || tool.progressStatus,
        };
        return;
      }
    }

    const insertedIndex =
      next.push({
        type: "tool",
        id: toolId,
        toolName: tool.toolName || "",
        params: tool.params || "",
        response: tool.response || "",
        interaction: tool.interaction,
        progressStatus: tool.progressStatus,
      }) - 1;
    if (toolId) timelineToolIndexById.set(toolId, insertedIndex);
    timelineToolIndexByFingerprint.set(toolFingerprint, insertedIndex);
  });

  return next;
};

export const truncateDetailText = (value?: string) => {
  if (!value) return "";
  const normalized = value.trim();
  if (normalized.length <= MAX_TOOL_DETAIL_CHARS) return normalized;
  return `${normalized.slice(0, MAX_TOOL_DETAIL_CHARS)}\n...`;
};

export const isDetailTruncated = (value?: string) => {
  if (!value) return false;
  return value.trim().length > MAX_TOOL_DETAIL_CHARS;
};
