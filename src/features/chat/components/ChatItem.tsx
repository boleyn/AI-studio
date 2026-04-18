import { Box, Button, Collapse, Flex, Grid, Icon, IconButton, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Spinner, Text } from "@chakra-ui/react";
import { getFileIcon } from "@fastgpt/global/common/file/icon";
import React from "react";
import Markdown from "@/components/Markdown";
import { useCopyData } from "@/hooks/useCopyData";
import { ToolStreamText, useChatItemViewModel } from "../hooks/useChatItemViewModel";
import type { MessageExecutionSummary } from "../utils/executionSummary";
import {
  PLAN_MODE_TOOL_NAMES,
  isDetailTruncated,
  isImageFile,
  truncateDetailText,
} from "../utils/chatItemParsers";
import PlanModeTimelineCard from "./message/PlanModeTimelineCard";

import type { ConversationMessage } from "@/types/conversation";

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
  hideInteractiveCards,
  onPlanQuestionSelect,
  onPlanQuestionsSubmit,
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
  hideInteractiveCards?: boolean;
  onPlanQuestionSelect?: (input: {
    messageId: string;
    requestId?: string;
    questionId: string;
    header?: string;
    question: string;
    optionLabel: string;
    optionDescription?: string;
  }) => void;
  onPlanQuestionsSubmit?: (input: {
    messageId: string;
    requestId: string;
    answers: Record<string, string>;
  }) => void;
  onPlanModeApprovalSelect?: (input: {
    messageId: string;
    requestId: string;
    action: "enter" | "exit";
    decision: "approve" | "reject";
  }) => void;
  onPermissionApprovalSelect?: (input: {
    messageId: string;
    toolName: string;
    toolUseId?: string;
    decision: "approve" | "reject";
  }) => void;
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
    detailModalData,
    isDetailModalOpen,
    planQuestions,
    planModeApprovalDecision,
    planModeApprovalPending,
    planModeApproval,
    permissionApproval,
    permissionApprovalDecision,
    timelineHasAnswer,
    hasAnswerText,
    latestAnswerIndex,
    showAssistantAnimation,
    hasRunningTool,
    toggleTimelineReasoningDetails,
    toggleTimelineToolDetails,
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
  const hasPendingPlanQuestions = planQuestions.length > 0;
  const currentPlanRequestId = planQuestions[0]?.requestId;
  const currentPlanSelectionsByRequest =
    message.additional_kwargs &&
    typeof message.additional_kwargs === "object" &&
    (message.additional_kwargs as Record<string, unknown>).planQuestionSelections &&
    typeof (message.additional_kwargs as Record<string, unknown>).planQuestionSelections === "object" &&
    !Array.isArray((message.additional_kwargs as Record<string, unknown>).planQuestionSelections)
      ? ((message.additional_kwargs as Record<string, unknown>).planQuestionSelections as Record<string, unknown>)
      : {};
  const currentPlanSelections =
    currentPlanRequestId &&
    currentPlanSelectionsByRequest[currentPlanRequestId] &&
    typeof currentPlanSelectionsByRequest[currentPlanRequestId] === "object" &&
    !Array.isArray(currentPlanSelectionsByRequest[currentPlanRequestId])
      ? (currentPlanSelectionsByRequest[currentPlanRequestId] as Record<string, unknown>)
      : {};
  const selectedPlanAnswerCount = planQuestions.reduce((count, item) => {
    const selected =
      typeof currentPlanSelections[item.id] === "string"
        ? String(currentPlanSelections[item.id]).trim()
        : "";
    return selected ? count + 1 : count;
  }, 0);
  const canSubmitPlanQuestions =
    Boolean(currentPlanRequestId) && planQuestions.length > 0 && selectedPlanAnswerCount >= planQuestions.length;
  const shouldShowPermissionApproval = Boolean(permissionApproval && !permissionApprovalDecision);
  const shouldHidePlanReasoning = Boolean(
    hasPendingPlanQuestions ||
      (planModeApproval && planModeApprovalPending && !planModeApprovalDecision) ||
      shouldShowPermissionApproval
  );
  const shouldSuppressPlanVerboseAnswer = Boolean(shouldHidePlanReasoning);

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
                    <Box key={`${file.name || "file"}-${index}`} bg="myWhite.100" borderRadius="md" overflow="hidden">
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
            {timelineItems.length > 0 ? (
              <Box>
                <Flex direction="column" gap={2}>
                  {timelineItems.map((item, index) => {
                    if (item.type === "reasoning") {
                      if (shouldHidePlanReasoning) return null;
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
                      const isRunning = isStreaming && !item.response;
                      const toolKey = `${messageId}-timeline-tool-${item.id || "unknown"}-${index}`;
                      const isExpanded = Boolean(expandedTimelineToolKeys[toolKey]);
                      const normalizedToolName = (item.toolName || "").trim().toLowerCase();
                      const isPlanModeTool = PLAN_MODE_TOOL_NAMES.has(normalizedToolName);
                      if (isPlanModeTool) {
                        return (
                          <PlanModeTimelineCard
                            isStreaming={isStreaming}
                            key={toolKey}
                            planModeApprovalDecision={planModeApprovalDecision}
                            planPreview={undefined}
                            toolItem={{
                              toolName: item.toolName,
                              interaction: item.interaction,
                              progressStatus: item.progressStatus,
                            }}
                          />
                        );
                      }

                      const truncatedParams = truncateDetailText(item.params);
                      const truncatedResponse = truncateDetailText(item.response);
                      const paramsTruncated = isDetailTruncated(item.params);
                      const responseTruncated = isDetailTruncated(item.response);

                      return (
                        <Box
                          key={toolKey}
                          bg="myGray.25"
                          border="1px solid"
                          borderColor="myGray.200"
                          borderRadius="10px"
                          py={2}
                          px={2}
                        >
                          <Flex align="center" gap={2}>
                            {isRunning ? (
                              <Spinner color="green.500" size="xs" speed="0.7s" thickness="2.5px" />
                            ) : (
                              <Box bg="myGray.350" borderRadius="full" h="6px" w="6px" />
                            )}
                            <Text color="myGray.700" fontSize="12px" fontWeight="600" noOfLines={1}>
                              {item.toolName || `工具 ${index + 1}`}
                            </Text>
                            {item.skillTag ? (
                              <Box
                                as="span"
                                display="inline-flex"
                                alignItems="center"
                                px={2}
                                py="1px"
                                borderRadius="8px"
                                border="1px solid"
                                borderColor="adora.300"
                                bg="adora.50"
                                color="adora.800"
                                fontSize="10px"
                                fontWeight={700}
                              >
                                skill: {item.skillTag}
                              </Box>
                            ) : null}
                            {isRunning ? (
                              <Text
                                bg="green.50"
                                border="1px solid"
                                borderColor="green.200"
                                borderRadius="999px"
                                color="green.700"
                                fontSize="10px"
                                ml={2}
                                px={2}
                                py="1px"
                              >
                                执行中
                              </Text>
                            ) : null}
                            <IconButton
                              aria-label={isExpanded ? "收起详情" : "展开详情"}
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
                              h="22px"
                              ml="auto"
                              minW="22px"
                              onClick={() => toggleTimelineToolDetails(toolKey)}
                              size="xs"
                              variant="ghost"
                            />
                          </Flex>

                          {isExpanded ? (
                            <Flex direction="column" gap={2} mt={2}>
                              <Box bg="myGray.25" border="1px solid" borderColor="myGray.200" borderRadius="8px" p={2}>
                                <Flex align="center" justify="space-between" mb={1}>
                                  <Text color="blue.700" fontSize="10px" fontWeight="700">入参</Text>
                                  {paramsTruncated ? (
                                    <Button
                                      colorScheme="blue"
                                      h="20px"
                                      minW="auto"
                                      onClick={() => openToolDetailModal(`${item.toolName || `工具 ${index + 1}`} · 入参`, item.params)}
                                      px={2}
                                      size="xs"
                                      variant="ghost"
                                    >
                                      查看完整
                                    </Button>
                                  ) : null}
                                </Flex>
                                <ToolStreamText color="myGray.600" fontSize="12px" isStreaming={isStreaming} value={truncatedParams || "{}"} />
                              </Box>

                              <Box bg="myGray.25" border="1px solid" borderColor="myGray.200" borderRadius="8px" p={2}>
                                <Flex align="center" justify="space-between" mb={1}>
                                  <Text color="primary.700" fontSize="10px" fontWeight="700">出参</Text>
                                  {responseTruncated ? (
                                    <Button
                                      colorScheme="primary"
                                      h="20px"
                                      minW="auto"
                                      onClick={() => openToolDetailModal(`${item.toolName || `工具 ${index + 1}`} · 出参`, item.response)}
                                      px={2}
                                      size="xs"
                                      variant="ghost"
                                    >
                                      查看完整
                                    </Button>
                                  ) : null}
                                </Flex>

                                {truncatedResponse ? (
                                  <ToolStreamText color="myGray.800" fontSize="12px" isStreaming={isStreaming} value={truncatedResponse} />
                                ) : isRunning ? (
                                  <Text color="myGray.500" fontSize="12px">执行中...</Text>
                                ) : (
                                  <Text color="myGray.400" fontSize="12px">暂无输出</Text>
                                )}
                              </Box>
                            </Flex>
                          ) : null}
                        </Box>
                      );
                    }

                    return (
                      <Box key={`${messageId}-timeline-answer-${index}`} pl={timelineStepIndexes.length > 0 ? "20px" : 0}>
                        {shouldSuppressPlanVerboseAnswer ? null : (
                          <Markdown showAnimation={showAssistantAnimation && index === latestAnswerIndex} source={item.text || ""} />
                        )}
                      </Box>
                    );
                  })}
                </Flex>
              </Box>
            ) : null}

            {(!timelineHasAnswer || timelineItems.length === 0) && content && !shouldSuppressPlanVerboseAnswer ? (
              <Markdown showAnimation={showAssistantAnimation} source={content} />
            ) : null}

            {isAssistant && !hideInteractiveCards && hasPendingPlanQuestions ? (
              <Box bg="myGray.25" border="1px solid" borderColor="myGray.200" borderRadius="10px" p={3}>
                <Text color="myGray.900" fontSize="12px" fontWeight="700">计划确认</Text>
                <Flex direction="column" gap={2} mt={2}>
                  {planQuestions.map((question, qIndex) => (
                    <Box key={`${question.requestId || "rq"}-${question.id}-${qIndex}`} bg="white" border="1px solid" borderColor="myGray.200" borderRadius="8px" p={2}>
                      <Text color="myGray.800" fontSize="12px" fontWeight="600">
                        {question.header || "确认"}: {question.question}
                      </Text>
                      <Flex gap={2} mt={2} wrap="wrap">
                        {question.options.map((option, oIndex) => (
                          <Button
                            key={`${question.id}-option-${oIndex}`}
                            h="28px"
                            onClick={() =>
                              onPlanQuestionSelect?.({
                                messageId,
                                requestId: question.requestId,
                                questionId: question.id,
                                header: question.header,
                                question: question.question,
                                optionLabel: option.label,
                                optionDescription: option.description,
                              })
                            }
                            size="sm"
                            variant="outline"
                          >
                            {option.label}
                          </Button>
                        ))}
                      </Flex>
                    </Box>
                  ))}
                </Flex>
                {planQuestions[0]?.requestId ? (
                  <Flex justify="flex-end" mt={3}>
                    <Button
                      colorScheme="primary"
                      isDisabled={Boolean(planQuestionSubmitting || !onPlanQuestionsSubmit || !canSubmitPlanQuestions)}
                      isLoading={Boolean(planQuestionSubmitting)}
                      onClick={() => {
                        const firstRequestId = planQuestions[0]?.requestId;
                        if (!firstRequestId) return;
                        const answers = planQuestions.reduce<Record<string, string>>((acc, item) => {
                          const selected =
                            typeof currentPlanSelections[item.id] === "string"
                              ? String(currentPlanSelections[item.id]).trim()
                              : "";
                          if (selected) acc[item.id] = selected;
                          return acc;
                        }, {});
                        onPlanQuestionsSubmit?.({
                          messageId,
                          requestId: firstRequestId,
                          answers,
                        });
                      }}
                      size="sm"
                    >
                      提交选择
                    </Button>
                  </Flex>
                ) : null}
                {planQuestions.length > 0 ? (
                  <Text color="myGray.500" fontSize="11px" mt={2}>
                    已选择 {selectedPlanAnswerCount}/{planQuestions.length}，全部选择后可提交。
                  </Text>
                ) : null}
              </Box>
            ) : null}

            {isAssistant &&
            !hideInteractiveCards &&
            planModeApproval &&
            planModeApprovalPending &&
            !planModeApprovalDecision ? (
              <Box bg="myGray.25" border="1px solid" borderColor="myGray.200" borderRadius="10px" p={3}>
                <Text color="myGray.900" fontSize="12px" fontWeight="700">
                  {planModeApproval.title || "计划模式审批"}
                </Text>
                {planModeApproval.description ? (
                  <Text color="myGray.700" fontSize="12px" mt={1} whiteSpace="pre-wrap">
                    {planModeApproval.description}
                  </Text>
                ) : null}
                <Flex gap={2} mt={3}>
                  <Button
                    colorScheme="primary"
                    isDisabled={Boolean(planModeApprovalSubmitting || !onPlanModeApprovalSelect)}
                    isLoading={Boolean(planModeApprovalSubmitting)}
                    onClick={() => {
                      if (!planModeApproval.requestId) return;
                      onPlanModeApprovalSelect?.({
                        messageId,
                        requestId: planModeApproval.requestId,
                        action: planModeApproval.action,
                        decision: "approve",
                      });
                    }}
                    size="sm"
                  >
                    批准
                  </Button>
                  <Button
                    isDisabled={Boolean(planModeApprovalSubmitting || !onPlanModeApprovalSelect)}
                    onClick={() => {
                      if (!planModeApproval.requestId) return;
                      onPlanModeApprovalSelect?.({
                        messageId,
                        requestId: planModeApproval.requestId,
                        action: planModeApproval.action,
                        decision: "reject",
                      });
                    }}
                    size="sm"
                    variant="outline"
                  >
                    拒绝
                  </Button>
                </Flex>
              </Box>
            ) : null}

            {isAssistant && !hideInteractiveCards && permissionApproval && !permissionApprovalDecision ? (
              <Box bg="myGray.25" border="1px solid" borderColor="myGray.200" borderRadius="10px" p={3}>
                <Text color="myGray.900" fontSize="12px" fontWeight="700">工具权限审批</Text>
                <Text color="myGray.700" fontSize="12px" mt={1}>
                  工具: {permissionApproval.toolName}
                </Text>
                {permissionApproval.reason ? (
                  <Text color="myGray.600" fontSize="12px" mt={1}>
                    {permissionApproval.reason}
                  </Text>
                ) : null}
                <Flex gap={2} mt={3}>
                  <Button
                    colorScheme="primary"
                    isDisabled={Boolean(planModeApprovalSubmitting || !onPermissionApprovalSelect)}
                    onClick={() =>
                      onPermissionApprovalSelect?.({
                        messageId,
                        toolName: permissionApproval.toolName,
                        toolUseId: permissionApproval.toolUseId,
                        decision: "approve",
                      })
                    }
                    size="sm"
                  >
                    允许
                  </Button>
                  <Button
                    isDisabled={Boolean(planModeApprovalSubmitting || !onPermissionApprovalSelect)}
                    onClick={() =>
                      onPermissionApprovalSelect?.({
                        messageId,
                        toolName: permissionApproval.toolName,
                        toolUseId: permissionApproval.toolUseId,
                        decision: "reject",
                      })
                    }
                    size="sm"
                    variant="outline"
                  >
                    拒绝
                  </Button>
                </Flex>
              </Box>
            ) : null}

            {shouldShowExecutionMeta ? (
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
    prevProps.planQuestionSubmitting === nextProps.planQuestionSubmitting &&
    prevProps.planModeApprovalSubmitting === nextProps.planModeApprovalSubmitting &&
    prevProps.hideInteractiveCards === nextProps.hideInteractiveCards &&
    prevProps.onPlanQuestionSelect === nextProps.onPlanQuestionSelect &&
    prevProps.onPlanQuestionsSubmit === nextProps.onPlanQuestionsSubmit &&
    prevProps.onPlanModeApprovalSelect === nextProps.onPlanModeApprovalSelect &&
    prevProps.onPermissionApprovalSelect === nextProps.onPermissionApprovalSelect
);
