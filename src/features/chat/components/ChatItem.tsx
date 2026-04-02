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
  Text,
  useDisclosure,
} from "@chakra-ui/react";
import { getFileIcon } from "@fastgpt/global/common/file/icon";
import { extractText } from "@shared/chat/messages";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "@/components/Markdown";
import { useCopyData } from "@/hooks/useCopyData";

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
}: {
  message: ConversationMessage;
  isStreaming?: boolean;
  messageId: string;
}) => {
  const content = extractText(message.content);
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const files = useMemo(() => getMessageFiles(message), [message]);
  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      const aImage = isImageFile(a);
      const bImage = isImageFile(b);
      if (aImage === bImage) return 0;
      return aImage ? 1 : -1;
    });
  }, [files]);
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
  if (!content.trim() && !isStreaming && files.length === 0 && timelineItems.length === 0) return null;

  return (
    <Flex justify={isUser ? "flex-end" : "flex-start"} w="full">
      <Box
        bg={
          isUser
            ? "linear-gradient(135deg, rgba(64,124,255,0.12) 0%, rgba(148,163,184,0.08) 100%)"
            : "rgba(255,255,255,0.92)"
        }
        border="1px solid"
        borderColor={isUser ? "rgba(52,122,255,0.34)" : "rgba(203,213,225,0.92)"}
        borderRadius={isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px"}
        boxShadow="0 8px 16px -14px rgba(15,23,42,0.28)"
        className="chat-message"
        color="myGray.700"
        fontSize="sm"
        maxW="92%"
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
        }}
      >
        {isUser ? (
          <Flex direction="column" gap={2}>
            {sortedFiles.length > 0 ? (
              <Grid alignItems="flex-start" gap={3} gridTemplateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }}>
                {sortedFiles.map((file, index) => {
                  const isImage = isImageFile(file);
                  const icon = getFileIcon(file.name || "");
                  const fileUrl = file.previewUrl || file.downloadUrl || "";
                  return (
                    <Box key={`${file.name || "file"}-${index}`} bg="white" borderRadius="md" overflow="hidden">
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
          <Text color="gray.500" fontSize="xs">
            {content}
          </Text>
        ) : (
          <Flex direction="column" gap={2}>
            {timelineItems.length > 0 ? (
              <Flex direction="column" gap={2}>
                {timelineItems.map((item, index) => {
                  if (item.type === "reasoning") {
                    const reasoningKey = item.id || `${messageId}-timeline-reasoning-${index}`;
                    const isLastStep = timelineStepIndexes[timelineStepIndexes.length - 1] === index;
                    const isExpanded = Boolean(expandedTimelineReasoningKeys[reasoningKey]);
                    const reasoningPhaseText = getReasoningPhaseText(index);
                    return (
                      <Flex key={reasoningKey} align="stretch" gap={2}>
                        <Flex align="center" direction="column" w="12px">
                          <Box bg="cyan.500" borderRadius="full" h="7px" mt="7px" w="7px" />
                          {!isLastStep ? <Box bg="gray.300" flex="1" mt={1} w="1px" /> : null}
                        </Flex>
                        <Box
                          bg="rgba(247,250,252,0.96)"
                          border="1px solid"
                          borderColor="rgba(186,230,253,0.95)"
                          borderRadius="10px"
                          flex="1"
                          minW={0}
                          p={2.5}
                        >
                          <Flex align="center" gap={2}>
                            <Text color="gray.700" flex="1" fontSize="12px" fontWeight="700" noOfLines={1}>
                              思考过程
                            </Text>
                            {reasoningPhaseText ? (
                              <Text color="blue.500" fontSize="11px">
                                {reasoningPhaseText}
                              </Text>
                            ) : null}
                            <IconButton
                              aria-label={isExpanded ? "收起思考内容" : "展开思考内容"}
                              icon={
                                <Icon
                                  boxSize={4}
                                  color="gray.500"
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
                              color="gray.700"
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
                    const isLastStep = timelineStepIndexes[timelineStepIndexes.length - 1] === index;
                    const truncatedParams = truncateDetailText(item.params);
                    const truncatedResponse = truncateDetailText(item.response);
                    const paramsTruncated = isDetailTruncated(item.params);
                    const responseTruncated = isDetailTruncated(item.response);
                    return (
                      <Flex key={toolKey} align="stretch" gap={2}>
                        <Flex align="center" direction="column" w="12px">
                          <Box bg={isRunning ? "blue.400" : "green.400"} borderRadius="full" h="7px" mt="7px" w="7px" />
                          {!isLastStep ? <Box bg="gray.300" flex="1" mt={1} w="1px" /> : null}
                        </Flex>
                        <Box
                          bg="rgba(248,250,252,0.95)"
                          border="1px solid"
                          borderColor="rgba(203,213,225,0.9)"
                          borderRadius="10px"
                          flex="1"
                          minW={0}
                          p={2.5}
                        >
                          <Flex align="center" gap={2}>
                            <Text color="gray.800" flex="1" fontSize="12px" fontWeight="600" noOfLines={1}>
                              {item.toolName || `工具 ${index + 1}`}
                            </Text>
                            <IconButton
                              aria-label={isExpanded ? "收起工具详情" : "展开工具详情"}
                              icon={
                                <Icon
                                  boxSize={4}
                                  color="gray.500"
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
                              <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={2}>
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
                                  color="gray.600"
                                  isStreaming={isStreaming}
                                  value={truncatedParams || "{}"}
                                />
                              </Box>

                              <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={2}>
                                <Flex align="center" justify="space-between" mb={1}>
                                  <Text color="green.700" fontSize="10px" fontWeight="700">
                                    出参
                                  </Text>
                                  {responseTruncated ? (
                                    <Button
                                      colorScheme="green"
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
                                    color="gray.800"
                                    isStreaming={isStreaming}
                                    value={truncatedResponse}
                                  />
                                ) : isRunning ? (
                                  <Text color="gray.500" fontSize="12px">
                                    执行中...
                                  </Text>
                                ) : (
                                  <Text color="gray.400" fontSize="12px">
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
            {(!timelineHasAnswer || timelineItems.length === 0) && content ? (
              <Markdown showAnimation={showAssistantAnimation} source={content} />
            ) : null}
          </Flex>
        )}
      </Box>

      <Modal isOpen={isDetailModalOpen} onClose={handleCloseDetailModal} size="xl">
        <ModalOverlay bg="blackAlpha.400" />
        <ModalContent>
          <ModalHeader fontSize="sm">{detailModalData?.title || "工具详情"}</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={4}>
            <Flex justify="flex-end" mb={2}>
              <Button
                colorScheme="blue"
                onClick={() => copyData(detailModalData?.content || "")}
                size="xs"
                variant="outline"
              >
                复制
              </Button>
            </Flex>
            <Box bg="gray.50" border="1px solid" borderColor="gray.200" borderRadius="8px" maxH="60vh" overflow="auto" p={3}>
              <ToolStreamText
                color="gray.800"
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
    prevProps.message === nextProps.message
);
