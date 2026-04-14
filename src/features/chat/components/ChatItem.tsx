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
  type PlanQuestion,
  type MessageFile,
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
  const { copyData } = useCopyData();
  const {
    content,
    isUser,
    isSystem,
    isAssistant,
    files,
    sortedFiles,
    sortedRequestFiles,
    timelineItems,
    timelineStepIndexes,
    expandedTimelineReasoningKeys,
    expandedTimelineToolKeys,
    detailModalData,
    isDetailModalOpen,
    planQuestions,
    planAnswers,
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
            {!hideInteractiveCards && planQuestions.length > 0 ? (
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
                    const normalizedToolName = (item.toolName || "").trim().toLowerCase();
                    const isPlanModeTool = PLAN_MODE_TOOL_NAMES.has(normalizedToolName);
                    if (isPlanModeTool) {
                      return hideInteractiveCards ? null : (
                        <PlanModeTimelineCard
                          isStreaming={isStreaming}
                          key={toolKey}
                          messageId={messageId}
                          onPlanModeApprovalSelect={onPlanModeApprovalSelect}
                          planModeApproval={planModeApproval}
                          planModeApprovalDecision={planModeApprovalDecision}
                          planModeApprovalSubmitting={planModeApprovalSubmitting}
                          planPreview={planPreview}
                          planProgress={planProgress}
                          toolItem={{
                            toolName: item.toolName,
                            response: item.response,
                          }}
                        />
                      );
                    }
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
    prevProps.hideInteractiveCards === nextProps.hideInteractiveCards &&
    prevProps.onPlanQuestionSelect === nextProps.onPlanQuestionSelect &&
    prevProps.onPlanModeApprovalSelect === nextProps.onPlanModeApprovalSelect &&
    prevProps.onPermissionApprovalSelect === nextProps.onPermissionApprovalSelect
);
