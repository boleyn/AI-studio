import { Text, useDisclosure } from "@chakra-ui/react";
import { extractText } from "@shared/chat/messages";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationMessage } from "@/types/conversation";
import {
  getPlanModeApprovalFromMessage,
  getPlanProgressFromMessage,
} from "../utils/planModeDisplay";
import {
  composeTimelineItems,
  formatExecutionTimeForHeader,
  getMessageFiles,
  getPathTailLabel,
  getPlanAnswers,
  getPlanQuestionSubmission,
  getPlanModeApprovalDecision,
  getPlanPreview,
  getPlanQuestions,
  getReasoningText,
  getRunStatus,
  getTimelineItems,
  getToolDetails,
  isImageFile,
  type MessageFile,
} from "../utils/chatItemParsers";
import {
  buildSubAgentTimelineEvents,
  SUB_AGENT_TOOL_NAMES,
} from "../utils/subAgentTimeline";

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

export const ToolStreamText = ({
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

export const useChatItemViewModel = ({
  message,
  requestMessage,
  requestContent,
  isStreaming,
  isLatestRun,
  messageId,
}: {
  message: ConversationMessage;
  requestMessage?: ConversationMessage;
  requestContent?: string;
  isStreaming?: boolean;
  isLatestRun?: boolean;
  messageId: string;
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
  const sortedFiles = useMemo(
    () =>
      [...files].sort((a, b) => {
        const aImage = isImageFile(a);
        const bImage = isImageFile(b);
        if (aImage === bImage) return 0;
        return aImage ? 1 : -1;
      }),
    [files]
  );
  const requestFiles = useMemo(() => (requestMessage ? getMessageFiles(requestMessage) : []), [requestMessage]);
  const sortedRequestFiles = useMemo(
    () =>
      [...requestFiles].sort((a, b) => {
        const aImage = isImageFile(a);
        const bImage = isImageFile(b);
        if (aImage === bImage) return 0;
        return aImage ? 1 : -1;
      }),
    [requestFiles]
  );
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
  const subAgentTimelineEvents = useMemo(
    () => buildSubAgentTimelineEvents(timelineItems),
    [timelineItems]
  );
  const timelineStepIndexes = useMemo(
    () =>
      timelineItems
        .map((item, index) => (item.type === "tool" || item.type === "reasoning" ? index : -1))
        .filter((index) => index >= 0),
    [timelineItems]
  );
  const [expandedTimelineReasoningKeys, setExpandedTimelineReasoningKeys] = useState<Record<string, boolean>>({});
  const [expandedTimelineToolKeys, setExpandedTimelineToolKeys] = useState<Record<string, boolean>>({});
  const [detailModalData, setDetailModalData] = useState<{ title: string; content: string } | null>(null);
  const { isOpen: isDetailModalOpen, onOpen: openDetailModal, onClose: closeDetailModal } = useDisclosure();
  const planQuestions = useMemo(() => getPlanQuestions(message), [message]);
  const planAnswers = useMemo(() => getPlanAnswers(message), [message]);
  const planQuestionSubmission = useMemo(() => getPlanQuestionSubmission(message), [message]);
  const planModeApprovalDecision = useMemo(() => getPlanModeApprovalDecision(message), [message]);
  const planPreview = useMemo(() => getPlanPreview(message), [message]);
  const planProgress = useMemo(() => getPlanProgressFromMessage(message), [message]);
  const planModeApproval = useMemo(() => getPlanModeApprovalFromMessage(message), [message]);

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
    () =>
      timelineItems.some((item) => {
        if (item.type !== "tool") return false;
        const normalizedToolName = (item.toolName || "").trim().toLowerCase();
        if (SUB_AGENT_TOOL_NAMES.has(normalizedToolName)) return false;
        return !item.response;
      }),
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

  return {
    content,
    isUser,
    isSystem,
    isAssistant,
    files,
    sortedFiles,
    sortedRequestFiles,
    timelineItems,
    subAgentTimelineEvents,
    timelineStepIndexes,
    expandedTimelineReasoningKeys,
    expandedTimelineToolKeys,
    detailModalData,
    isDetailModalOpen,
    planQuestions,
    planAnswers,
    planQuestionSubmission,
    planModeApprovalDecision,
    planPreview,
    planProgress,
    planModeApproval,
    timelineHasAnswer,
    hasAnswerText,
    latestAnswerIndex,
    showAssistantAnimation,
    hasRunningTool,
    headerStatusText,
    roleTitle,
    hasRequestContent,
    requestPreview,
    requestImageCount,
    requestFileCount,
    requestSelectedProjectFiles,
    requestSelectedProjectFileLabel,
    requestFileNamePreview,
    headerDotColor,
    isRunExpanded,
    setIsRunExpanded,
    toggleTimelineReasoningDetails,
    toggleTimelineToolDetails,
    openToolDetailModal,
    handleCloseDetailModal,
    getReasoningPhaseText,
  };
};

export type UseChatItemViewModelResult = ReturnType<typeof useChatItemViewModel>;
export type { MessageFile };
