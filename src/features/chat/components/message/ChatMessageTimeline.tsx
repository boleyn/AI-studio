import { Box, Flex, Spinner, Text } from "@chakra-ui/react";
import { extractText } from "@shared/chat/messages";
import type { TFunction } from "next-i18next";
import type { ConversationMessage } from "@/types/conversation";
import { ChatInteractionProvider, type ChatInteractionContextValue } from "../../context/ChatInteractionContext";
import type { MessageExecutionSummary } from "../../utils/executionSummary";
import { getExecutionSummary } from "../../utils/executionSummary";
import type { MessageRating } from "./MessageActionBar";
import ChatMessageBlock from "./ChatMessageBlock";

const VIRTUAL_FAILED_ASSISTANT_PREFIX = "virtual-failed-assistant:";

type ChatRow = {
  key: string;
  message: ConversationMessage;
  messageId: string;
  requestMessage?: ConversationMessage;
  requestContent?: string;
  summary: MessageExecutionSummary | null;
  isStreaming: boolean;
  canRegenerate: boolean;
  rating?: MessageRating;
};

const buildChatRows = ({
  messages,
  streamingMessageId,
  isSending,
  messageRatings,
}: {
  messages: ConversationMessage[];
  streamingMessageId: string | null;
  isSending: boolean;
  messageRatings: Record<string, MessageRating | undefined>;
}): ChatRow[] => {
  const visibleMessages = messages.filter((message) => {
    const kwargs =
      message.additional_kwargs && typeof message.additional_kwargs === "object"
        ? (message.additional_kwargs as Record<string, unknown>)
        : null;
    return kwargs?.hiddenFromTimeline !== true;
  });
  const rows: ChatRow[] = [];

  for (let index = 0; index < visibleMessages.length; index += 1) {
    const message = visibleMessages[index];
    const nextMessage = visibleMessages[index + 1];
    if (message.role === "user" && nextMessage?.role === "assistant") {
      const userMessageId = message.id ?? `user-${index}`;
      const assistantMessageId = nextMessage.id ?? `assistant-${index + 1}`;
      rows.push({
        key: `${userMessageId}__${assistantMessageId}`,
        message: nextMessage,
        messageId: assistantMessageId,
        requestMessage: message,
        requestContent: extractText(message.content),
        summary: getExecutionSummary(nextMessage),
        isStreaming: nextMessage.id === streamingMessageId,
        canRegenerate: true,
        rating: messageRatings[assistantMessageId],
      });
      index += 1;
      continue;
    }

    if (message.role === "user" && !nextMessage && !isSending) {
      const userMessageId = message.id ?? `user-${index}`;
      const virtualAssistantId = `${VIRTUAL_FAILED_ASSISTANT_PREFIX}${userMessageId}`;
      const virtualMessage: ConversationMessage = {
        type: "assistant",
        subtype: "result",
        role: "assistant",
        id: virtualAssistantId,
        time: message.time,
        content: "请求失败（历史记录未保存回复），可点击重新生成。",
        status: "error",
      };
      rows.push({
        key: `${userMessageId}__${virtualAssistantId}`,
        message: virtualMessage,
        messageId: virtualAssistantId,
        requestMessage: message,
        requestContent: extractText(message.content),
        summary: getExecutionSummary(virtualMessage),
        isStreaming: false,
        canRegenerate: true,
      });
      continue;
    }

    const messageId = message.id ?? `${message.role}-${index}`;
    let canRegenerate = false;
    if (message.role === "assistant") {
      canRegenerate = messages.slice(0, index).some((item) => item.role === "user");
    }
    rows.push({
      key: messageId,
      message,
      messageId,
      summary: getExecutionSummary(message),
      isStreaming: message.id === streamingMessageId,
      canRegenerate,
      rating: messageRatings[messageId],
    });
  }
  return rows;
};

const ChatMessageTimeline = ({
  t,
  messages,
  streamingMessageId,
  isSending,
  isLoadingConversation,
  messageRatings,
  onDelete,
  onRate,
  onRegenerate,
  chatInteractionContextValue,
}: {
  t: TFunction;
  messages: ConversationMessage[];
  streamingMessageId: string | null;
  isSending: boolean;
  isLoadingConversation: boolean;
  messageRatings: Record<string, MessageRating | undefined>;
  onDelete: (messageId: string) => void;
  onRate: (messageId: string, rating: MessageRating) => void;
  onRegenerate: (messageId: string) => void;
  chatInteractionContextValue: ChatInteractionContextValue;
}) => {
  const rows = buildChatRows({
    messages,
    streamingMessageId,
    isSending,
    messageRatings,
  });

  return (
    <Flex direction="column" gap={3} pt={14}>
      <ChatInteractionProvider value={chatInteractionContextValue}>
        {rows.map((row, rowIndex) => {
          const isLastRow = rowIndex === rows.length - 1;
          const rowStatusColor = row.isStreaming
            ? "green.500"
            : row.message.status === "error"
            ? "red.500"
            : "blue.500";
          return (
            <Flex key={row.key} align="stretch" gap={3} w="full">
              <Flex align="center" direction="column" w="16px">
                {row.isStreaming ? (
                  <Spinner color="green.500" mt="8px" size="xs" speed="0.7s" thickness="2.5px" />
                ) : (
                  <Box bg={rowStatusColor} borderRadius="full" h="9px" mt="10px" w="9px" />
                )}
                {!isLastRow ? <Box bg="myGray.200" flex="1" mt={1} w="2px" /> : null}
              </Flex>
              <Box flex="1" minW={0}>
                <ChatMessageBlock
                  canRegenerate={row.canRegenerate}
                  isLatestRun={isLastRow}
                  isStreaming={row.isStreaming}
                  message={row.message}
                  messageId={row.messageId}
                  onDelete={onDelete}
                  onRate={onRate}
                  onRegenerate={onRegenerate}
                  rating={row.rating}
                  requestContent={row.requestContent}
                  requestMessage={row.requestMessage}
                  summary={row.summary}
                />
              </Box>
            </Flex>
          );
        })}
      </ChatInteractionProvider>
      {isLoadingConversation ? (
        <Flex align="center" color="gray.500" gap={2} justify="center" py={1}>
          <Spinner size="xs" />
          <Text fontSize="xs">{t("chat:loading_conversation", { defaultValue: "加载对话..." })}</Text>
        </Flex>
      ) : null}
    </Flex>
  );
};

export default ChatMessageTimeline;
