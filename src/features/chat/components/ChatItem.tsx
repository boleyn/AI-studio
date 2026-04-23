import { Box, Button, Collapse, Flex, Grid, Icon, IconButton, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Spinner, Text } from "@chakra-ui/react";
import { getFileIcon } from "@fastgpt/global/common/file/icon";
import React from "react";
import Markdown from "@/components/Markdown";
import { ChevronDownIcon } from "@/components/common/Icon";
import { useCopyData } from "@/hooks/useCopyData";
import { ToolStreamText, useChatItemViewModel } from "../hooks/useChatItemViewModel";
import type { MessageExecutionSummary } from "../utils/executionSummary";
import AgentTimelineCard from "./message/timeline/AgentTimelineCard";
import ToolTimelineCard from "./message/timeline/ToolTimelineCard";
import {
  PLAN_MODE_TOOL_NAMES,
  isImageFile,
} from "../utils/chatItemParsers";

import type { ConversationMessage } from "@/types/conversation";

const ChatItem = ({
  message,
  isStreaming,
  messageId,
  executionSummary,
  requestMessage,
  requestContent,
  isLatestRun,
  hideInteractiveCards,
  onOpenWorkspaceFile,
}: {
  message: ConversationMessage;
  isStreaming?: boolean;
  messageId: string;
  executionSummary?: MessageExecutionSummary | null;
  requestMessage?: ConversationMessage;
  requestContent?: string;
  isLatestRun?: boolean;
  hideInteractiveCards?: boolean;
  onOpenWorkspaceFile?: (filePath: string) => boolean;
}) => {
  const { copyData } = useCopyData();
  const {
    content,
    isUser,
    isSystem,
    isAssistant,
    files,
    sortedFiles,
    timelineItems,
    timelineStepIndexes,
    expandedTimelineReasoningKeys,
    expandedTimelineToolKeys,
    expandedTimelineAgentKeys,
    detailModalData,
    isDetailModalOpen,
    planProgress,
    timelineHasAnswer,
    hasAnswerText,
    latestAnswerIndex,
    showAssistantAnimation,
    hasRunningTool,
    toggleTimelineReasoningDetails,
    toggleTimelineToolDetails,
    toggleTimelineAgentDetails,
    openToolDetailModal,
    handleCloseDetailModal,
    getReasoningPhaseText,
  } = useChatItemViewModel({
    message,
    requestMessage,
    requestContent,
    isStreaming,
    isLatestRun,
    messageId,
  });

  const shouldShowExecutionMeta = !isUser && !isSystem && Boolean(executionSummary);

  if (!content.trim() && !isStreaming && files.length === 0 && timelineItems.length === 0) return null;

  const markdownSx = {
    "& .markdown p": { marginTop: "8px", marginBottom: "8px" },
    "& .markdown ul, & .markdown ol": { marginTop: "4px", marginBottom: "4px" },
    "& .markdown li": { marginTop: "1px", marginBottom: "1px", lineHeight: 1.23 },
    "& .markdown li > p": { marginTop: "1px", marginBottom: "1px" },
    "& .markdown li > ul, & .markdown li > ol": { marginTop: "2px", marginBottom: "2px" },
  } as const;

  return (
    <Flex justify={isUser ? "flex-end" : "flex-start"} w="full">
      <Box
        bg={isUser ? "white" : isSystem ? "transparent" : "myWhite.100"}
        border={isUser || isAssistant ? "1px solid" : "none"}
        borderColor={isUser ? "myGray.300" : isAssistant ? "myGray.200" : "transparent"}
        borderRadius={isUser ? "16px 16px 6px 16px" : isAssistant ? "16px 16px 16px 6px" : 0}
        boxShadow={isUser || isAssistant ? "sm" : "none"}
        className="chat-message"
        color="myGray.700"
        fontSize="sm"
        maxW="100%"
        w={isUser || isAssistant ? "fit-content" : "full"}
        minW={isUser ? "88px" : isAssistant ? "200px" : 0}
        px={isUser || isAssistant ? 4 : 0}
        py={isUser || isAssistant ? 3 : 0}
        sx={markdownSx}
      >
        {isUser ? (
          <Flex direction="column" gap={2}>
            {sortedFiles.length > 0 ? (
              <Grid alignItems="flex-start" gap={3} gridTemplateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }}>
                {sortedFiles.map((file, index) => {
                  const image = isImageFile(file);
                  const icon = getFileIcon(file.name || "");
                  const fileUrl = file.previewUrl || file.downloadUrl || "";
                  return (
                    <Box
                      key={`${file.name || "file"}-${index}`}
                      bg="myWhite.100"
                      border="1px solid"
                      borderColor="myGray.200"
                      borderRadius="md"
                      overflow="hidden"
                    >
                      {image ? (
                        fileUrl ? (
                          <Box as="img" src={fileUrl} alt={file.name || `文件 ${index + 1}`} maxH="220px" objectFit="contain" w="100%" />
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
          <Text color="myGray.500" fontSize="xs">{content}</Text>
        ) : (
          <Flex direction="column" gap={2}>
            {planProgress ? (
              <Box bg="purple.50" border="1px solid" borderColor="purple.200" borderRadius="10px" p={3}>
                <Flex align="center" gap={2} mb={2}>
                  <Box bg="purple.500" borderRadius="full" h="7px" w="7px" />
                  <Text color="purple.700" fontSize="12px" fontWeight="600">执行计划</Text>
                </Flex>
                {planProgress.explanation ? (
                  <Text color="purple.600" fontSize="12px" mb={3}>{planProgress.explanation}</Text>
                ) : null}
                <Flex direction="column" gap={2}>
                  {planProgress.plan.map((item, index) => (
                    <Flex key={index} align="flex-start" gap={2}>
                      <Box mt="2px">
                        {item.status === "completed" ? (
                          <Icon viewBox="0 0 24 24" color="green.500" boxSize="14px" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                          </Icon>
                        ) : item.status === "in_progress" ? (
                          <Spinner color="purple.500" size="xs" speed="0.7s" thickness="2px" />
                        ) : (
                          <Icon viewBox="0 0 24 24" color="myGray.400" boxSize="14px" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/>
                          </Icon>
                        )}
                      </Box>
                      <Text
                        color={item.status === "completed" ? "myGray.500" : "myGray.700"}
                        fontSize="12px"
                        textDecoration={item.status === "completed" ? "line-through" : "none"}
                      >
                        {item.step}
                      </Text>
                    </Flex>
                  ))}
                </Flex>
              </Box>
            ) : null}

            {timelineItems.length > 0 ? (
              <Box>
                <Flex direction="column" gap={2}>
                  {timelineItems.map((item, index) => {
                    if (item.type === "agent") {
                      return (
                        <AgentTimelineCard
                          key={item.id || `${messageId}-timeline-agent-${index}`}
                          index={index}
                          isExpanded={Boolean(expandedTimelineAgentKeys[item.id || `${messageId}-timeline-agent-${index}`])}
                          isStreaming={isStreaming}
                          item={item}
                          onOpenToolDetailModal={openToolDetailModal}
                          onToggle={() => toggleTimelineAgentDetails(item.id || `${messageId}-timeline-agent-${index}`)}
                        />
                      );
                    }

                    if (item.type === "reasoning") {
                      const reasoningKey = item.id || `${messageId}-timeline-reasoning-${index}`;
                      const isExpanded = Boolean(expandedTimelineReasoningKeys[reasoningKey]);
                      const reasoningPhaseText = getReasoningPhaseText(index);
                      const isReasoningRunning =
                        Boolean(reasoningPhaseText) && !hasRunningTool && !hasAnswerText && !timelineHasAnswer;
                      return (
                        <Box key={reasoningKey} bg="green.50" border="1px solid" borderColor="green.200" borderRadius="10px" p={2}>
                          <Flex align="center" gap={2}>
                            {isReasoningRunning ? (
                              <Spinner color="green.500" size="xs" speed="0.7s" thickness="2.5px" />
                            ) : (
                              <Box bg="green.500" borderRadius="full" h="7px" w="7px" />
                            )}
                            <Text color="myGray.700" flex="1" fontSize="12px" fontWeight="600">
                              思考过程
                            </Text>
                            <IconButton
                              aria-label={isExpanded ? "收起思考内容" : "展开思考内容"}
                              icon={
                                <Icon
                                  as={ChevronDownIcon}
                                  boxSize="14px"
                                  color="myGray.500"
                                  transform={isExpanded ? "rotate(180deg)" : "rotate(0deg)"}
                                  transition="transform 0.2s ease"
                                />
                              }
                              h="22px"
                              minW="22px"
                              onClick={() => toggleTimelineReasoningDetails(reasoningKey)}
                              size="xs"
                              variant="ghost"
                            />
                          </Flex>
                          <Collapse animateOpacity in={isExpanded}>
                            <Box mt={2}>
                              <Markdown source={item.text || ""} />
                            </Box>
                          </Collapse>
                        </Box>
                      );
                    }

                    if (item.type === "tool") {
                      const normalizedToolName = (item.toolName || "").trim().toLowerCase();
                      const isPlanModeTool = PLAN_MODE_TOOL_NAMES.has(normalizedToolName);
                      if (isPlanModeTool) {
                        return null;
                      }
                      const toolKey = `${messageId}-timeline-tool-${item.id || "unknown"}-${index}`;
                      return (
                        <ToolTimelineCard
                          key={toolKey}
                          index={index}
                          isExpanded={Boolean(expandedTimelineToolKeys[toolKey])}
                          isStreaming={isStreaming}
                          item={item}
                          onOpenWorkspaceFile={onOpenWorkspaceFile}
                          onOpenToolDetailModal={openToolDetailModal}
                          onToggle={() => toggleTimelineToolDetails(toolKey)}
                        />
                      );
                    }

                    if (item.type === "compact") {
                      const compact = item.compact || { trigger: "auto" as const };
                      const preText =
                        typeof compact.preTokens === "number"
                          ? `${(compact.preTokens / 1000).toFixed(1)}k`
                          : "--";
                      const postText =
                        typeof compact.postTokens === "number"
                          ? `${(compact.postTokens / 1000).toFixed(1)}k`
                          : "--";
                      const savedText =
                        typeof compact.savedTokens === "number"
                          ? `${(compact.savedTokens / 1000).toFixed(1)}k`
                          : "";
                      const afterPercentText =
                        typeof compact.usedPercentAfter === "number"
                          ? `${compact.usedPercentAfter.toFixed(1)}%`
                          : "";
                      return (
                        <Box
                          key={`${messageId}-timeline-compact-${index}`}
                          bg={compact.trigger === "manual" ? "orange.50" : "blue.50"}
                          border="1px solid"
                          borderColor={compact.trigger === "manual" ? "orange.200" : "blue.200"}
                          borderRadius="10px"
                          p={2}
                        >
                          <Flex align="center" gap={2} justify="space-between">
                            <Text color="myGray.700" fontSize="12px" fontWeight="700">
                              {compact.trigger === "manual" ? "已手动压缩上下文" : "已自动压缩上下文"}
                            </Text>
                            {savedText ? (
                              <Text color="green.600" fontFamily="mono" fontSize="11px" fontWeight="700">
                                -{savedText}
                              </Text>
                            ) : null}
                          </Flex>
                          <Flex color="myGray.600" fontFamily="mono" fontSize="11px" gap={3} mt={1} wrap="wrap">
                            <Text>{preText} → {postText} tokens</Text>
                            {afterPercentText ? <Text>压缩后占用 {afterPercentText}</Text> : null}
                          </Flex>
                        </Box>
                      );
                    }

                    return (
                      <Box key={`${messageId}-timeline-answer-${index}`} pl={timelineStepIndexes.length > 0 ? "20px" : 0}>
                        <Markdown showAnimation={showAssistantAnimation && index === latestAnswerIndex} source={item.text || ""} />
                      </Box>
                    );
                  })}
                </Flex>
              </Box>
            ) : null}

            {(!timelineHasAnswer || timelineItems.length === 0) && content ? (
              <Markdown showAnimation={showAssistantAnimation} source={content} />
            ) : null}

            {shouldShowExecutionMeta && timelineItems.every((item) => item.type !== "agent") ? (
              <Flex align="center" borderTop="1px solid" borderColor="myGray.200" color="myGray.600" fontSize="11px" gap={3} mt={1} pt={2} wrap="wrap">
                <Text>调用工具: {executionSummary?.nodeCount ?? 0}</Text>
                {executionSummary?.durationSeconds !== undefined ? (
                  <Text>耗时: {executionSummary.durationSeconds.toFixed(2)}s</Text>
                ) : null}
              </Flex>
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
              <Button colorScheme="primary" onClick={() => copyData(detailModalData?.content || "")} size="xs" variant="outline">
                复制
              </Button>
            </Flex>
            <Box bg="myGray.50" border="1px solid" borderColor="myGray.200" borderRadius="8px" maxH="60vh" overflow="auto" p={3}>
              <ToolStreamText color="myGray.800" fontSize="12px" isStreaming={isStreaming} value={detailModalData?.content || ""} />
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
    prevProps.hideInteractiveCards === nextProps.hideInteractiveCards &&
    prevProps.onOpenWorkspaceFile === nextProps.onOpenWorkspaceFile
);
