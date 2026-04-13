import {
  Box,
  Button,
  Collapse,
  Flex,
  Grid,
  Icon,
  IconButton,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Text,
  useDisclosure,
} from "@chakra-ui/react";
import { getFileIcon } from "@fastgpt/global/common/file/icon";
import { extractText } from "@shared/chat/messages";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "@/components/Markdown";
import { useCopyData } from "@/hooks/useCopyData";
import type { MessageExecutionSummary } from "../utils/executionSummary";

import type { ConversationMessage } from "@/types/conversation";

interface MessageFile {
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

interface ToolDetail {
  id?: string;
  toolName?: string;
  params?: string;
  response?: string;
}
interface TimelineItem {
  type: "reasoning" | "answer" | "tool";
  text?: string;
  id?: string;
  toolName?: string;
  params?: string;
  response?: string;
}

interface PlanQuestionOption {
  label: string;
  description?: string;
}

interface PlanQuestion {
  header: string;
  id: string;
  question: string;
  options: PlanQuestionOption[];
}

interface PlanModeApproval {
  action: "enter" | "exit";
  title?: string;
  description?: string;
  rationale?: string;
  options?: Array<{
    label: string;
    value: "approve" | "reject";
  }>;
}

interface PermissionApproval {
  toolName: string;
  reason?: string;
}

const MAX_TOOL_DETAIL_CHARS = 800;

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

const getToolFingerprint = (toolName?: string, params?: string, response?: string) => {
  const normalizedName = (toolName || "").trim().toLowerCase();
  const normalizedParams = normalizeToolPayload(params);
  const normalizedResponse = normalizeToolPayload(response);
  return `${normalizedName}::${normalizedParams}::${normalizedResponse}`;
};

const getMessageFiles = (message: ConversationMessage): MessageFile[] => {
  if (!message.artifact || typeof message.artifact !== "object") return [];
  const files = (message.artifact as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  return files.filter((file): file is MessageFile => Boolean(file && typeof file === "object"));
};

const isImageFile = (file: MessageFile) => {
  if (typeof file.type === "string" && file.type.startsWith("image/")) return true;
  const name = typeof file.name === "string" ? file.name.toLowerCase() : "";
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"].some((ext) =>
    name.endsWith(ext)
  );
};

const getToolDetails = (message: ConversationMessage): ToolDetail[] => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return [];
  const kwargs = message.additional_kwargs as {
    toolDetails?: unknown;
    responseData?: unknown;
  };

  const detailsFromToolDetails = Array.isArray(kwargs.toolDetails)
    ? kwargs.toolDetails.filter((item): item is ToolDetail => Boolean(item && typeof item === "object"))
    : [];
  const detailsFromResponseData = Array.isArray(kwargs.responseData)
    ? kwargs.responseData
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item, index) => ({
      id: typeof item.nodeId === "string" ? `${item.nodeId}-${index}` : undefined,
      toolName: typeof item.moduleName === "string" ? item.moduleName : undefined,
      params:
        typeof item.toolInput === "string"
          ? item.toolInput
          : item.toolInput == null
          ? ""
          : JSON.stringify(item.toolInput, null, 2),
      response:
        typeof item.toolRes === "string"
          ? item.toolRes
          : item.toolRes == null
          ? ""
          : JSON.stringify(item.toolRes, null, 2),
    }))
    : [];

  // 在历史数据中，toolDetails 可能只包含少量“工具调用壳子”，而 responseData 才是完整执行清单。
  // 选择条目更多的来源，避免出现“调用工具数很多，但只展示少量同名工具”的问题。
  return detailsFromResponseData.length > detailsFromToolDetails.length
    ? detailsFromResponseData
    : detailsFromToolDetails;
};

const getReasoningText = (message: ConversationMessage): string => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return "";
  const kwargs = message.additional_kwargs as {
    reasoning_text?: unknown;
    reasoning_content?: unknown;
  };
  const value = kwargs.reasoning_text ?? kwargs.reasoning_content;
  return typeof value === "string" ? value : "";
};
const getTimelineItems = (message: ConversationMessage): TimelineItem[] => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return [];
  const value = (message.additional_kwargs as { timeline?: unknown }).timeline;
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      type:
        item.type === "reasoning" || item.type === "answer" || item.type === "tool"
          ? item.type
          : "answer",
      text: typeof item.text === "string" ? item.text : undefined,
      id: typeof item.id === "string" ? item.id : undefined,
      toolName: typeof item.toolName === "string" ? item.toolName : undefined,
      params: typeof item.params === "string" ? item.params : undefined,
      response: typeof item.response === "string" ? item.response : undefined,
    }));
};

const getPlanQuestions = (message: ConversationMessage): PlanQuestion[] => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return [];
  const raw = (message.additional_kwargs as { planQuestions?: unknown }).planQuestions;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
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

const getPlanAnswers = (message: ConversationMessage): Record<string, string> => {
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

const getPlanModeApproval = (message: ConversationMessage): PlanModeApproval | null => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return null;
  const value = (message.additional_kwargs as { planModeApproval?: unknown }).planModeApproval;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const action = record.action === "exit" ? "exit" : record.action === "enter" ? "enter" : null;
  if (!action) return null;
  const options = Array.isArray(record.options)
    ? record.options
        .filter((opt): opt is Record<string, unknown> => Boolean(opt && typeof opt === "object"))
        .map((opt) => ({
          label: typeof opt.label === "string" ? opt.label : "",
          value:
            opt.value === "reject"
              ? ("reject" as const)
              : opt.value === "approve"
              ? ("approve" as const)
              : ("approve" as const),
        }))
        .filter((opt) => opt.label)
    : [];
  return {
    action,
    title: typeof record.title === "string" ? record.title : undefined,
    description: typeof record.description === "string" ? record.description : undefined,
    rationale: typeof record.rationale === "string" ? record.rationale : undefined,
    options,
  };
};

const getPlanModeApprovalDecision = (message: ConversationMessage): "approve" | "reject" | "" => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return "";
  const value = (message.additional_kwargs as { planModeApprovalDecision?: unknown }).planModeApprovalDecision;
  return value === "approve" || value === "reject" ? value : "";
};

const getPermissionApproval = (message: ConversationMessage): PermissionApproval | null => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return null;
  const value = (message.additional_kwargs as { permissionApproval?: unknown }).permissionApproval;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const toolName = typeof record.toolName === "string" ? record.toolName.trim() : "";
  if (!toolName) return null;
  return {
    toolName,
    reason: typeof record.reason === "string" ? record.reason : undefined,
  };
};

const getPermissionApprovalDecision = (message: ConversationMessage): "approve" | "reject" | "" => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return "";
  const value = (message.additional_kwargs as { permissionApprovalDecision?: unknown })
    .permissionApprovalDecision;
  return value === "approve" || value === "reject" ? value : "";
};

const getRunStatus = (
  message: ConversationMessage,
  isStreaming?: boolean
): "running" | "success" | "error" => {
  if (isStreaming) return "running";
  if (message.status === "error") return "error";
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return "success";
  const responseData = Array.isArray((message.additional_kwargs as { responseData?: unknown }).responseData)
    ? ((message.additional_kwargs as { responseData?: Array<{ status?: string }> }).responseData ?? [])
    : [];
  if (responseData.some((item) => item && typeof item === "object" && item.status === "error")) {
    return "error";
  }
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
    // Heuristic: treat small values as seconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const formatExecutionTimeForHeader = (value: unknown): string | null => {
  const d = toValidDate(value);
  if (!d) return null;

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();

  const isSameDay =
    now.getFullYear() === d.getFullYear() && now.getMonth() === d.getMonth() && now.getDate() === d.getDate();

  const formatHMS = (date: Date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  const formatYMD = (date: Date) =>
    `${date.getFullYear()}年${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日`;

  // Future timestamps: fall back to the actual time.
  if (diffMs < 0) return formatHMS(d);

  // Relative phrases should take priority for fresh messages, even if
  // upstream timestamp timezone formatting is inconsistent.
  if (diffMs <= 10_000) return "刚刚";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}秒前`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}分钟前`;

  if (isSameDay) {
    return formatHMS(d);
  }

  return formatYMD(d);
};

const getPathTailLabel = (value: string): string => {
  const normalized = (value || "").replace(/\\/g, "/");
  const base = normalized.split("/").filter(Boolean).pop() || value;
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
};

const composeTimelineItems = ({
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
    timelineToolIndexByFingerprint.set(
      getToolFingerprint(item.toolName, item.params, item.response),
      index
    );
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
        response: target.response || tool.response,
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
          response: target.response || tool.response,
        };
        return;
      }
    }
    const insertedIndex = next.push({
      type: "tool",
      id: toolId,
      toolName: tool.toolName || "",
      params: tool.params || "",
      response: tool.response || "",
    }) - 1;
    if (toolId) {
      timelineToolIndexById.set(toolId, insertedIndex);
    }
    timelineToolIndexByFingerprint.set(toolFingerprint, insertedIndex);
  });

  return next;
};

const truncateDetailText = (value?: string) => {
  if (!value) return "";
  const normalized = value.trim();
  if (normalized.length <= MAX_TOOL_DETAIL_CHARS) return normalized;
  return `${normalized.slice(0, MAX_TOOL_DETAIL_CHARS)}\n...`;
};

const isDetailTruncated = (value?: string) => {
  if (!value) return false;
  return value.trim().length > MAX_TOOL_DETAIL_CHARS;
};

const useTypewriterText = (value: string, enabled: boolean) => {
  const normalizedValue = value || "";
  const [displayed, setDisplayed] = useState(normalizedValue);
  const displayedRef = useRef(normalizedValue);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (!enabled) {
      setDisplayed(normalizedValue);
      displayedRef.current = normalizedValue;
      return;
    }

    const current = displayedRef.current;
    if (!normalizedValue.startsWith(current) || normalizedValue.length <= current.length) {
      setDisplayed(normalizedValue);
      displayedRef.current = normalizedValue;
      return;
    }

    let cursor = current.length;
    const target = normalizedValue;

    const tick = () => {
      if (cursor >= target.length) {
        rafRef.current = null;
        return;
      }
      const remaining = target.length - cursor;
      const step = Math.max(1, Math.min(8, Math.ceil(remaining / 24)));
      cursor = Math.min(target.length, cursor + step);
      const nextText = target.slice(0, cursor);
      displayedRef.current = nextText;
      setDisplayed(nextText);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [enabled, normalizedValue]);

  return displayed;
};

const ToolStreamText = ({
  value,
  isStreaming,
  color,
  fontSize = "11px",
}: {
  value: string;
  isStreaming?: boolean;
  color: string;
  fontSize?: string;
}) => {
  const displayValue = useTypewriterText(value, Boolean(isStreaming));
  return (
    <Text
      color={color}
      fontFamily="mono"
      fontSize={fontSize}
      overflowWrap="anywhere"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
    >
      {displayValue}
    </Text>
  );
};

const ChatItem = ({
  message,
  isStreaming,
  messageId,
  executionSummary,
  requestMessage,
  requestContent,
  isLatestRun,
  planQuestionSubmitting,
  planModeApprovalSubmitting,
  onPlanQuestionSelect,
  onPlanModeApprovalSelect,
  onPermissionApprovalSelect,
}: {
  message: ConversationMessage;
  isStreaming?: boolean;
  messageId: string;
  executionSummary?: MessageExecutionSummary | null;
  requestMessage?: ConversationMessage;
  requestContent?: string;
  isLatestRun?: boolean;
  planQuestionSubmitting?: boolean;
  planModeApprovalSubmitting?: boolean;
  onPlanQuestionSelect?: (input: {
    messageId: string;
    questionId: string;
    header?: string;
    question: string;
    optionLabel: string;
    optionDescription?: string;
  }) => void;
  onPlanModeApprovalSelect?: (input: {
    messageId: string;
    action: "enter" | "exit";
    decision: "approve" | "reject";
  }) => void;
  onPermissionApprovalSelect?: (input: {
    messageId: string;
    toolName: string;
    decision: "approve" | "reject";
  }) => void;
}) => {
  const content = extractText(message.content);
  const messageType = (message.type || message.role || "assistant") as
    | "user"
    | "assistant"
    | "system"
    | "tool"
    | "progress";
  const isUser = messageType === "user";
  const isSystem = messageType === "system";
  const isAssistant = !isUser && !isSystem;

  const files = useMemo(() => getMessageFiles(message), [message]);
  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      const aImage = isImageFile(a);
      const bImage = isImageFile(b);
      if (aImage === bImage) return 0;
      return aImage ? 1 : -1;
    });
  }, [files]);
  const requestFiles = useMemo(() => (requestMessage ? getMessageFiles(requestMessage) : []), [requestMessage]);
  const sortedRequestFiles = useMemo(() => {
    return [...requestFiles].sort((a, b) => {
      const aImage = isImageFile(a);
      const bImage = isImageFile(b);
      if (aImage === bImage) return 0;
      return aImage ? 1 : -1;
    });
  }, [requestFiles]);
  const toolDetails = useMemo(() => getToolDetails(message), [message]);
  const reasoningText = useMemo(() => getReasoningText(message), [message]);
  const rawTimelineItems = useMemo(() => getTimelineItems(message), [message]);
  const timelineItems = useMemo(
    () =>
      composeTimelineItems({
        rawTimelineItems,
        reasoningText,
        toolDetails,
      }),
    [rawTimelineItems, reasoningText, toolDetails]
  );
  const timelineStepIndexes = useMemo(
    () =>
      timelineItems
        .map((item, index) => (item.type === "tool" || item.type === "reasoning" ? index : -1))
        .filter((index) => index >= 0),
    [timelineItems]
  );
  const [expandedTimelineReasoningKeys, setExpandedTimelineReasoningKeys] = useState<
    Record<string, boolean>
  >({});
  const [expandedTimelineToolKeys, setExpandedTimelineToolKeys] = useState<Record<string, boolean>>({});
  const [detailModalData, setDetailModalData] = useState<{ title: string; content: string } | null>(null);
  const { isOpen: isDetailModalOpen, onOpen: openDetailModal, onClose: closeDetailModal } = useDisclosure();
  const { copyData } = useCopyData();
  const planQuestions = useMemo(() => getPlanQuestions(message), [message]);
  const planAnswers = useMemo(() => getPlanAnswers(message), [message]);
  const planModeApproval = useMemo(() => getPlanModeApproval(message), [message]);
  const planModeApprovalDecision = useMemo(() => getPlanModeApprovalDecision(message), [message]);
  const permissionApproval = useMemo(() => getPermissionApproval(message), [message]);
  const permissionApprovalDecision = useMemo(() => getPermissionApprovalDecision(message), [message]);

  const toggleTimelineReasoningDetails = useCallback((key: string) => {
    setExpandedTimelineReasoningKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);
  const toggleTimelineToolDetails = useCallback((key: string) => {
    setExpandedTimelineToolKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const openToolDetailModal = useCallback(
    (title: string, content?: string) => {
      setDetailModalData({
        title,
        content: content || "",
      });
      openDetailModal();
    },
    [openDetailModal]
  );

  const handleCloseDetailModal = useCallback(() => {
    closeDetailModal();
    setDetailModalData(null);
  }, [closeDetailModal]);

  const timelineHasAnswer = timelineItems.some(
    (item) => item.type === "answer" && typeof item.text === "string" && item.text.trim().length > 0
  );
  const hasAnswerText = content.trim().length > 0;
  const latestReasoningIndex = useMemo(() => {
    let latest = -1;
    timelineItems.forEach((item, index) => {
      if (item.type === "reasoning") latest = index;
    });
    return latest;
  }, [timelineItems]);
  const latestAnswerIndex = useMemo(() => {
    let latest = -1;
    timelineItems.forEach((item, index) => {
      if (item.type === "answer") latest = index;
    });
    return latest;
  }, [timelineItems]);
  const getReasoningPhaseText = useCallback(
    (index: number) => {
      if (!isStreaming || index !== latestReasoningIndex) return "";
      return hasAnswerText || timelineHasAnswer ? "回复中..." : "思考中...";
    },
    [hasAnswerText, isStreaming, latestReasoningIndex, timelineHasAnswer]
  );
  const showAssistantAnimation = Boolean(isStreaming && !isUser && !isSystem);
  const hasRunningTool = useMemo(
    () => timelineItems.some((item) => item.type === "tool" && !item.response),
    [timelineItems]
  );
  const headerStatusText = useMemo(() => {
    if (!isAssistant || !isStreaming) return "";
    if (hasRunningTool) return "调用工具中...";
    return hasAnswerText || timelineHasAnswer ? "回复中..." : "思考中...";
  }, [hasAnswerText, hasRunningTool, isAssistant, isStreaming, timelineHasAnswer]);
  const runStatus = useMemo(() => getRunStatus(message, isStreaming), [isStreaming, message]);
  const executionTimeText = useMemo(() => formatExecutionTimeForHeader((message as { time?: unknown }).time), [message]);
  const roleTitle = isUser
    ? "输入"
    : isSystem
    ? "系统消息"
    : executionTimeText
    ? `${executionTimeText}`
    : "执行时间";
  const shouldShowExecutionMeta = !isUser && !isSystem && Boolean(executionSummary);
  const hasRequestContent = Boolean(requestContent?.trim());
  const requestPreview = useMemo(
    () =>
      (requestContent || "")
        .replace(/\[[^\]]+\]\((?:FILETAG|SKILLTAG):[^)]+\)/g, " ")
        .replace(/(?:FILETAG|SKILLTAG):[^\s)\]]+/g, " ")
        .replace(/(?:^|\s)(?:FILETAG|SKILLTAG):\S+/g, " ")
        .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
        .replace(/[`*_>#\[\]\(\)\-!]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    [requestContent]
  );
  const requestImageCount = useMemo(
    () => sortedRequestFiles.filter((file) => isImageFile(file)).length,
    [sortedRequestFiles]
  );
  const requestFileCount = useMemo(
    () => sortedRequestFiles.length - requestImageCount,
    [requestImageCount, sortedRequestFiles.length]
  );
  const requestFileNamePreview = useMemo(() => {
    const names = sortedRequestFiles
      .map((file) => (file.name || "").trim())
      .filter(Boolean)
      .slice(0, 2);
    return names.join("、");
  }, [sortedRequestFiles]);
  const requestSelectedProjectFiles = useMemo(() => {
    if (!requestMessage?.additional_kwargs || typeof requestMessage.additional_kwargs !== "object") return [];
    const raw = (requestMessage.additional_kwargs as { selectedFilePaths?: unknown }).selectedFilePaths;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
  }, [requestMessage]);
  const requestSelectedProjectFileLabel = useMemo(() => {
    if (requestSelectedProjectFiles.length === 0) return "";
    const labels = requestSelectedProjectFiles.map((path) => getPathTailLabel(path)).filter(Boolean);
    const unique = Array.from(new Set(labels)).slice(0, 2);
    return unique.join("、");
  }, [requestSelectedProjectFiles]);
  const headerDotColor = isUser
    ? "adora.500"
    : isSystem
    ? "myGray.500"
    : runStatus === "running"
    ? "green.500"
    : runStatus === "error"
    ? "red.500"
    : "blue.500";
  const [isRunExpanded, setIsRunExpanded] = useState(() => !isAssistant || Boolean(isStreaming));
  useEffect(() => {
    if (!isAssistant) {
      setIsRunExpanded(true);
      return;
    }
    if (isStreaming || isLatestRun) {
      setIsRunExpanded(true);
      return;
    }
    setIsRunExpanded(false);
  }, [isAssistant, isLatestRun, isStreaming, messageId]);

  if (!content.trim() && !isStreaming && files.length === 0 && timelineItems.length === 0) return null;

  return (
    <Flex justify="flex-start" w="full">
      <Box
        bg={isUser ? "primary.50" : "myWhite.100"}
        border="1px solid"
        borderColor={isUser ? "primary.200" : "myGray.250"}
        borderRadius="14px"
        boxShadow="sm"
        className="chat-message"
        color="myGray.700"
        fontSize="sm"
        maxW="100%"
        w="full"
        minW="88px"
        minH="0"
        px={4}
        py={3}
        sx={{
          "& .markdown p": {
            marginTop: "8px",
            marginBottom: "8px",
          },
          "& .markdown ul, & .markdown ol": {
            marginTop: "4px",
            marginBottom: "4px",
          },
          "& .markdown li": {
            marginTop: "1px",
            marginBottom: "1px",
            lineHeight: 1.23,
          },
          "& .markdown li > p": {
            marginTop: "1px",
            marginBottom: "1px",
          },
          "& .markdown li > ul, & .markdown li > ol": {
            marginTop: "2px",
            marginBottom: "2px",
          },
          ...(isStreaming
            ? {
                "&, & *": {
                  scrollbarWidth: "none",
                  msOverflowStyle: "none",
                },
                "&::-webkit-scrollbar, & *::-webkit-scrollbar": {
                  width: "0px",
                  height: "0px",
                  display: "none",
                },
              }
            : {}),
        }}
      >
        {!isSystem ? (
          <Flex
            align="center"
            borderBottom="1px solid"
            borderColor={isUser ? "primary.200" : "myGray.200"}
            gap={2}
            justify="space-between"
            mb={3}
            pb={2}
          >
            <Flex align="center" gap={2}>
              {!isAssistant ? (
                <Box
                  bg={headerDotColor}
                  borderRadius="full"
                  h="8px"
                  w="8px"
                />
              ) : null}
              <Text color="myGray.800" fontSize="12px" fontWeight="700" letterSpacing="0.02em">
                {roleTitle}
              </Text>
            </Flex>
            {isAssistant ? (
              <Flex align="center" gap={2}>
                {headerStatusText ? (
                  <Flex align="center" color="green.600" fontSize="11px" fontWeight="700" gap={1}>
                    <Spinner color="green.500" size="xs" speed="0.7s" thickness="2px" />
                    <Text color="green.600" fontSize="11px" fontWeight="700">
                      {headerStatusText}
                    </Text>
                  </Flex>
                ) : null}
                <IconButton
                  aria-label={isRunExpanded ? "收起执行结果" : "展开执行结果"}
                  icon={
                    <Icon
                      boxSize={4}
                      color="myGray.500"
                      transform={isRunExpanded ? "rotate(180deg)" : "rotate(0deg)"}
                      transition="transform 0.2s ease"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M6 9L12 15L18 9"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </Icon>
                  }
                  h="24px"
                  minW="24px"
                  onClick={() => setIsRunExpanded((prev) => !prev)}
                  size="xs"
                  variant="ghost"
                  _focusVisible={{ boxShadow: "none", bg: "myGray.100" }}
                />
              </Flex>
            ) : null}
          </Flex>
        ) : null}
        {isAssistant && !isRunExpanded ? (
          <Flex color="myGray.600" direction="column" fontSize="11px" gap={1.5} mb={1} minW={0}>
            <Flex align="center" gap={2} minW={0} wrap="wrap">
              <Text color="myGray.500" flexShrink={0}>
                输入
              </Text>
              {requestImageCount > 0 ? (
                <Text
                  bg="blue.50"
                  border="1px solid"
                  borderColor="blue.200"
                  borderRadius="999px"
                  color="blue.700"
                  flexShrink={0}
                  px={2}
                  py="1px"
                >
                  图片
                </Text>
              ) : null}
              {requestFileCount > 0 ? (
                <Text
                  bg="adora.50"
                  border="1px solid"
                  borderColor="adora.200"
                  borderRadius="999px"
                  color="adora.700"
                  flexShrink={0}
                  px={2}
                  py="1px"
                >
                  文件
                </Text>
              ) : null}
              {requestSelectedProjectFiles.length > 0 ? (
                <Text
                  bg="primary.50"
                  border="1px solid"
                  borderColor="primary.200"
                  borderRadius="999px"
                  color="primary.700"
                  flexShrink={0}
                  px={2}
                  py="1px"
                >
                  项目文件
                </Text>
              ) : null}
              <Text
                minW={0}
                noOfLines={1}
                title={
                  requestPreview ||
                  requestFileNamePreview ||
                  requestSelectedProjectFileLabel ||
                  "无输入摘要"
                }
              >
                {requestPreview || requestFileNamePreview || requestSelectedProjectFileLabel || "无输入摘要"}
              </Text>
            </Flex>
            <Flex align="center" gap={3} wrap="wrap">
              <Text>调用工具: {executionSummary?.nodeCount ?? 0}</Text>
              {executionSummary?.durationSeconds !== undefined ? (
                <Text>耗时: {executionSummary.durationSeconds.toFixed(2)}s</Text>
              ) : null}
            </Flex>
          </Flex>
        ) : null}
        <Collapse animateOpacity in={!isAssistant || isRunExpanded}>
        {isUser ? (
          <Flex direction="column" gap={2}>
            {sortedFiles.length > 0 ? (
              <Grid alignItems="flex-start" gap={3} gridTemplateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }}>
                {sortedFiles.map((file, index) => {
                  const isImage = isImageFile(file);
                  const icon = getFileIcon(file.name || "");
                  const fileUrl = file.previewUrl || file.downloadUrl || "";
                  return (
                    <Box key={`${file.name || "file"}-${index}`} bg="myWhite.100" borderRadius="md" overflow="hidden">
                      {isImage ? (
                        fileUrl ? (
                          <Box
                            alt={file.name || `文件 ${index + 1}`}
                            as="img"
                            maxH="220px"
                            objectFit="contain"
                            src={fileUrl}
                            w="100%"
                          />
                        ) : null
                      ) : (
                        <Flex
                          alignItems="center"
                          cursor={fileUrl ? "pointer" : "default"}
                          onClick={() => {
                            if (!fileUrl) return;
                            window.open(fileUrl);
                          }}
                          p={2}
                          w="100%"
                        >
                          <Box as="img" h="24px" src={`/icons/chat/${icon}.svg`} w="24px" />
                          <Text fontSize="xs" ml={2} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                            {file.name || fileUrl || `文件 ${index + 1}`}
                          </Text>
                        </Flex>
                      )}
                    </Box>
                  );
                })}
              </Grid>
            ) : null}

            {content ? <Markdown source={content} /> : null}
          </Flex>
        ) : isSystem ? (
          <Text color="myGray.500" fontSize="xs">
            {content}
          </Text>
        ) : (
          <Flex direction="column" gap={2}>
            {planModeApproval ? (
              <Box bg="cyan.50" border="1px solid" borderColor="cyan.200" borderRadius="10px" p={3}>
                <Text color="cyan.800" fontSize="12px" fontWeight={700}>
                  {planModeApproval.title || "计划模式审批"}
                </Text>
                <Text color="myGray.700" fontSize="12px" mt={1}>
                  {planModeApproval.description ||
                    (planModeApproval.action === "enter" ? "请求进入计划模式。" : "请求退出计划模式。")}
                </Text>
                {planModeApproval.rationale ? (
                  <Text color="myGray.600" fontSize="11px" mt={1.5}>
                    说明: {planModeApproval.rationale}
                  </Text>
                ) : null}
                {planModeApprovalDecision ? (
                  <Text color="cyan.700" fontSize="11px" mt={2}>
                    已选择: {planModeApprovalDecision === "approve" ? "批准" : "拒绝"}
                  </Text>
                ) : null}
                <Flex gap={2} mt={2}>
                  {(planModeApproval.options && planModeApproval.options.length > 0
                    ? planModeApproval.options
                    : [
                        { label: "批准", value: "approve" as const },
                        { label: "拒绝", value: "reject" as const },
                      ]
                  ).map((option, idx) => (
                    <Button
                      key={`${messageId}-plan-mode-approval-option-${idx}`}
                      bg={planModeApprovalDecision === option.value ? "cyan.100" : "white"}
                      border="1px solid"
                      borderColor={planModeApprovalDecision === option.value ? "cyan.300" : "myGray.200"}
                      color={planModeApprovalDecision === option.value ? "cyan.800" : "myGray.700"}
                      h="26px"
                      isDisabled={Boolean(planModeApprovalSubmitting || planModeApprovalDecision)}
                      onClick={() =>
                        onPlanModeApprovalSelect?.({
                          messageId,
                          action: planModeApproval.action,
                          decision: option.value,
                        })
                      }
                      px={2}
                      size="xs"
                      variant="ghost"
                    >
                      {option.label}
                    </Button>
                  ))}
                </Flex>
              </Box>
            ) : null}
            {permissionApproval ? (
              <Box bg="purple.50" border="1px solid" borderColor="purple.200" borderRadius="10px" p={3}>
                <Text color="purple.800" fontSize="12px" fontWeight={700}>
                  工具权限审批
                </Text>
                <Text color="myGray.700" fontSize="12px" mt={1}>
                  工具 `{permissionApproval.toolName}` 请求执行，请确认是否批准。
                </Text>
                {permissionApproval.reason ? (
                  <Text color="myGray.600" fontSize="11px" mt={1.5}>
                    说明: {permissionApproval.reason}
                  </Text>
                ) : null}
                {permissionApprovalDecision ? (
                  <Text color="purple.700" fontSize="11px" mt={2}>
                    已选择: {permissionApprovalDecision === "approve" ? "批准" : "拒绝"}
                  </Text>
                ) : null}
                <Flex gap={2} mt={2}>
                  {[
                    { label: "批准", value: "approve" as const },
                    { label: "拒绝", value: "reject" as const },
                  ].map((option, idx) => (
                    <Button
                      key={`${messageId}-permission-approval-option-${idx}`}
                      bg={permissionApprovalDecision === option.value ? "purple.100" : "white"}
                      border="1px solid"
                      borderColor={permissionApprovalDecision === option.value ? "purple.300" : "myGray.200"}
                      color={permissionApprovalDecision === option.value ? "purple.800" : "myGray.700"}
                      h="26px"
                      isDisabled={Boolean(planModeApprovalSubmitting || permissionApprovalDecision)}
                      onClick={() =>
                        onPermissionApprovalSelect?.({
                          messageId,
                          toolName: permissionApproval.toolName,
                          decision: option.value,
                        })
                      }
                      px={2}
                      size="xs"
                      variant="ghost"
                    >
                      {option.label}
                    </Button>
                  ))}
                </Flex>
              </Box>
            ) : null}
            {planQuestions.length > 0 ? (
              <Box bg="amber.50" border="1px solid" borderColor="orange.200" borderRadius="10px" p={3}>
                <Text color="orange.800" fontSize="12px" fontWeight={700} mb={2}>
                  计划确认
                </Text>
                <Flex direction="column" gap={2.5}>
                  {planQuestions.map((question) => {
                    const selectedLabel = planAnswers[question.id] || "";
                    return (
                      <Box key={`${messageId}-plan-question-${question.id}`} bg="white" border="1px solid" borderColor="orange.100" borderRadius="8px" p={2.5}>
                        <Text color="myGray.700" fontSize="12px" fontWeight={700}>
                          {question.header || "确认"}
                        </Text>
                        <Text color="myGray.700" fontSize="12px" mt={1}>
                          {question.question}
                        </Text>
                        {selectedLabel ? (
                          <Text color="orange.700" fontSize="11px" mt={2}>
                            已选择: {selectedLabel}
                          </Text>
                        ) : null}
                        {question.options.length > 0 ? (
                          <Flex flexWrap="wrap" gap={2} mt={2}>
                            {question.options.map((option, optionIndex) => {
                              const isSelected = selectedLabel === option.label;
                              return (
                                <Button
                                  key={`${messageId}-plan-option-${question.id}-${optionIndex}`}
                                  bg={isSelected ? "orange.100" : "white"}
                                  border="1px solid"
                                  borderColor={isSelected ? "orange.300" : "myGray.200"}
                                  color={isSelected ? "orange.800" : "myGray.700"}
                                  h="26px"
                                  isDisabled={Boolean(planQuestionSubmitting || selectedLabel)}
                                  onClick={() =>
                                    onPlanQuestionSelect?.({
                                      messageId,
                                      questionId: question.id,
                                      header: question.header,
                                      question: question.question,
                                      optionLabel: option.label,
                                      optionDescription: option.description,
                                    })
                                  }
                                  px={2}
                                  size="xs"
                                  variant="ghost"
                                >
                                  {option.label}
                                </Button>
                              );
                            })}
                          </Flex>
                        ) : null}
                      </Box>
                    );
                  })}
                </Flex>
              </Box>
            ) : null}
            {(hasRequestContent || timelineItems.length > 0) ? (
              <Box position="relative">
                <Box
                  bg="myGray.200"
                  borderRadius="999px"
                  bottom={2}
                  left="5px"
                  position="absolute"
                  top={2}
                  w="1px"
                />
                <Flex direction="column" gap={2} position="relative">
                  {hasRequestContent ? (
                    <Flex align="stretch" gap={2}>
                      <Flex align="center" direction="column" w="12px">
                        <Box bg="adora.500" borderRadius="full" h="7px" mt="7px" w="7px" />
                      </Flex>
                      <Box bg="myGray.50" border="1px solid" borderColor="myGray.250" borderRadius="10px" flex="1" minW={0} p={2.5}>
                        {sortedRequestFiles.length > 0 ? (
                          <Grid alignItems="flex-start" gap={3} gridTemplateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} mb={2}>
                            {sortedRequestFiles.map((file, index) => {
                              const isImage = isImageFile(file);
                              const icon = getFileIcon(file.name || "");
                              const fileUrl = file.previewUrl || file.downloadUrl || "";
                              return (
                                <Box
                                  key={`${file.name || "request-file"}-${index}`}
                                  bg="myWhite.100"
                                  borderRadius="md"
                                  overflow="hidden"
                                >
                                  {isImage ? (
                                    fileUrl ? (
                                      <Box
                                        alt={file.name || `文件 ${index + 1}`}
                                        as="img"
                                        maxH="220px"
                                        objectFit="contain"
                                        src={fileUrl}
                                        w="100%"
                                      />
                                    ) : null
                                  ) : (
                                    <Flex
                                      alignItems="center"
                                      cursor={fileUrl ? "pointer" : "default"}
                                      onClick={() => {
                                        if (!fileUrl) return;
                                        window.open(fileUrl);
                                      }}
                                      p={2}
                                      w="100%"
                                    >
                                      <Box as="img" h="24px" src={`/icons/chat/${icon}.svg`} w="24px" />
                                      <Text
                                        fontSize="xs"
                                        ml={2}
                                        overflow="hidden"
                                        textOverflow="ellipsis"
                                        whiteSpace="nowrap"
                                      >
                                        {file.name || fileUrl || `文件 ${index + 1}`}
                                      </Text>
                                    </Flex>
                                  )}
                                </Box>
                              );
                            })}
                          </Grid>
                        ) : null}
                        <Box
                          color="myGray.700"
                          sx={{
                            "& .markdown p": {
                              marginTop: "4px",
                              marginBottom: "4px",
                            },
                          }}
                        >
                          <Markdown source={requestContent || ""} />
                        </Box>
                      </Box>
                    </Flex>
                  ) : null}
                  {timelineItems.length > 0 ? (
                    <Flex direction="column" gap={2}>
                {timelineItems.map((item, index) => {
                  if (item.type === "reasoning") {
                    const reasoningKey = item.id || `${messageId}-timeline-reasoning-${index}`;
                    const isExpanded = Boolean(expandedTimelineReasoningKeys[reasoningKey]);
                    const reasoningPhaseText = getReasoningPhaseText(index);
                    const isReasoningRunning =
                      Boolean(reasoningPhaseText) && !hasRunningTool && !hasAnswerText && !timelineHasAnswer;
                    return (
                      <Flex key={reasoningKey} align="stretch" gap={2}>
                        <Flex align="center" direction="column" w="12px">
                          {isReasoningRunning ? (
                            <Spinner color="green.500" mt="5px" size="xs" speed="0.7s" thickness="2.5px" />
                          ) : (
                            <Box bg="primary.500" borderRadius="full" h="7px" mt="7px" w="7px" />
                          )}
                        </Flex>
                        <Box
                          bg="primary.50"
                          border="1px solid"
                          borderColor="primary.200"
                          borderRadius="10px"
                          flex="1"
                          minW={0}
                          p={2.5}
                        >
                          <Flex align="center" gap={2}>
                            <Text color="myGray.700" flex="1" fontSize="12px" fontWeight="700" noOfLines={1}>
                              思考过程
                            </Text>
                            <IconButton
                              aria-label={isExpanded ? "收起思考内容" : "展开思考内容"}
                              icon={
                                <Icon
                                  boxSize={4}
                                  color="myGray.500"
                                  transform={isExpanded ? "rotate(180deg)" : "rotate(0deg)"}
                                  transition="transform 0.2s ease"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    d="M6 9L12 15L18 9"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="2"
                                  />
                                </Icon>
                              }
                              h="24px"
                              minW="24px"
                              onClick={() => toggleTimelineReasoningDetails(reasoningKey)}
                              size="xs"
                              variant="ghost"
                            />
                          </Flex>
                          <Collapse animateOpacity in={isExpanded}>
                            <Box
                              color="myGray.700"
                              mt={2}
                              sx={{
                                "& .markdown blockquote": {
                                  background: "transparent",
                                  borderLeft: "0",
                                  margin: 0,
                                  paddingLeft: 0,
                                },
                              }}
                            >
                              <Markdown source={item.text || ""} />
                            </Box>
                          </Collapse>
                        </Box>
                      </Flex>
                    );
                  }
                  if (item.type === "tool") {
                    const toolKey = `${messageId}-timeline-tool-${item.id || "unknown"}-${index}`;
                    const isExpanded = Boolean(expandedTimelineToolKeys[toolKey]);
                    const isRunning = isStreaming && !item.response;
                    const truncatedParams = truncateDetailText(item.params);
                    const truncatedResponse = truncateDetailText(item.response);
                    const paramsTruncated = isDetailTruncated(item.params);
                    const responseTruncated = isDetailTruncated(item.response);
                    return (
                      <Flex key={toolKey} align="stretch" gap={2}>
                        <Flex align="center" direction="column" w="12px">
                          {isRunning ? (
                            <Spinner color="green.500" mt="5px" size="xs" speed="0.7s" thickness="2.5px" />
                          ) : (
                            <Box
                              bg="primary.500"
                              borderRadius="full"
                              h="7px"
                              mt="7px"
                              w="7px"
                            />
                          )}
                        </Flex>
                        <Box
                          bg="myGray.25"
                          border="1px solid"
                          borderColor="myGray.250"
                          borderRadius="10px"
                          flex="1"
                          minW={0}
                          p={2.5}
                        >
                          <Flex align="center" gap={2}>
                            <Text color="myGray.800" flex="1" fontSize="12px" fontWeight="600" noOfLines={1}>
                              {item.toolName || `工具 ${index + 1}`}
                            </Text>
                            <IconButton
                              aria-label={isExpanded ? "收起工具详情" : "展开工具详情"}
                              icon={
                                <Icon
                                  boxSize={4}
                                  color="myGray.500"
                                  transform={isExpanded ? "rotate(180deg)" : "rotate(0deg)"}
                                  transition="transform 0.2s ease"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    d="M6 9L12 15L18 9"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="2"
                                  />
                                </Icon>
                              }
                              minW="24px"
                              h="24px"
                              onClick={() => toggleTimelineToolDetails(toolKey)}
                              size="xs"
                              variant="ghost"
                            />
                          </Flex>
                          <Collapse animateOpacity in={isExpanded}>
                            <Flex direction="column" gap={2} mt={2}>
                              <Box bg="myWhite.100" border="1px solid" borderColor="myGray.200" borderRadius="8px" p={2}>
                                <Flex align="center" justify="space-between" mb={1}>
                                  <Text color="blue.700" fontSize="10px" fontWeight="700">
                                    入参
                                  </Text>
                                  {paramsTruncated ? (
                                    <Button
                                      colorScheme="blue"
                                      h="20px"
                                      minW="auto"
                                      onClick={() =>
                                        openToolDetailModal(`${item.toolName || `工具 ${index + 1}`} · 入参`, item.params)
                                      }
                                      px={2}
                                      size="xs"
                                      variant="ghost"
                                    >
                                      查看完整
                                    </Button>
                                  ) : null}
                                </Flex>
                                <ToolStreamText
                                  color="myGray.600"
                                  isStreaming={isStreaming}
                                  value={truncatedParams || "{}"}
                                />
                              </Box>

                              <Box bg="myWhite.100" border="1px solid" borderColor="myGray.200" borderRadius="8px" p={2}>
                                <Flex align="center" justify="space-between" mb={1}>
                                  <Text color="primary.700" fontSize="10px" fontWeight="700">
                                    出参
                                  </Text>
                                  {responseTruncated ? (
                                    <Button
                                      colorScheme="primary"
                                      h="20px"
                                      minW="auto"
                                      onClick={() =>
                                        openToolDetailModal(`${item.toolName || `工具 ${index + 1}`} · 出参`, item.response)
                                      }
                                      px={2}
                                      size="xs"
                                      variant="ghost"
                                    >
                                      查看完整
                                    </Button>
                                  ) : null}
                                </Flex>
                                {truncatedResponse ? (
                                  <ToolStreamText
                                    color="myGray.800"
                                    isStreaming={isStreaming}
                                    value={truncatedResponse}
                                  />
                                ) : isRunning ? (
                                  <Text color="myGray.500" fontSize="12px">
                                    执行中...
                                  </Text>
                                ) : (
                                  <Text color="myGray.400" fontSize="12px">
                                    暂无输出
                                  </Text>
                                )}
                              </Box>
                            </Flex>
                          </Collapse>
                        </Box>
                      </Flex>
                    );
                  }
                  return (
                    <Box key={`${messageId}-timeline-answer-${index}`} pl={timelineStepIndexes.length > 0 ? "20px" : 0}>
                      <Markdown
                        showAnimation={showAssistantAnimation && index === latestAnswerIndex}
                        source={item.text || ""}
                      />
                    </Box>
                  );
                })}
                    </Flex>
                  ) : null}
                </Flex>
              </Box>
            ) : null}
            {(!timelineHasAnswer || timelineItems.length === 0) && content ? (
              <Markdown showAnimation={showAssistantAnimation} source={content} />
            ) : null}
            {shouldShowExecutionMeta ? (
              <Flex
                align="center"
                borderTop="1px solid"
                borderColor="myGray.200"
                color="myGray.600"
                fontSize="11px"
                gap={3}
                mt={1}
                pt={2}
                wrap="wrap"
              >
                <Text>
                  调用工具: {executionSummary?.nodeCount ?? 0}
                </Text>
                {executionSummary?.durationSeconds !== undefined ? (
                  <Text>耗时: {executionSummary.durationSeconds.toFixed(2)}s</Text>
                ) : null}
              </Flex>
            ) : null}
          </Flex>
        )}
        </Collapse>
      </Box>

      <Modal isOpen={isDetailModalOpen} onClose={handleCloseDetailModal} size="xl">
        <ModalOverlay bg="blackAlpha.400" />
        <ModalContent>
          <ModalHeader fontSize="sm">{detailModalData?.title || "工具详情"}</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={4}>
            <Flex justify="flex-end" mb={2}>
              <Button
                colorScheme="primary"
                onClick={() => copyData(detailModalData?.content || "")}
                size="xs"
                variant="outline"
              >
                复制
              </Button>
            </Flex>
            <Box bg="myGray.50" border="1px solid" borderColor="myGray.200" borderRadius="8px" maxH="60vh" overflow="auto" p={3}>
              <ToolStreamText
                color="myGray.800"
                fontSize="12px"
                isStreaming={isStreaming}
                value={detailModalData?.content || ""}
              />
            </Box>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Flex>
  );
};

export default React.memo(
  ChatItem,
  (prevProps, nextProps) =>
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.messageId === nextProps.messageId &&
    prevProps.message === nextProps.message &&
    prevProps.executionSummary?.nodeCount === nextProps.executionSummary?.nodeCount &&
    prevProps.executionSummary?.durationSeconds === nextProps.executionSummary?.durationSeconds &&
    prevProps.requestContent === nextProps.requestContent &&
    prevProps.isLatestRun === nextProps.isLatestRun &&
    prevProps.planQuestionSubmitting === nextProps.planQuestionSubmitting &&
    prevProps.planModeApprovalSubmitting === nextProps.planModeApprovalSubmitting &&
    prevProps.onPlanQuestionSelect === nextProps.onPlanQuestionSelect &&
    prevProps.onPlanModeApprovalSelect === nextProps.onPlanModeApprovalSelect &&
    prevProps.onPermissionApprovalSelect === nextProps.onPermissionApprovalSelect
);
