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
  role: "user" | "assistant" | "system";
  requestMessage?: ConversationMessage;
  requestContent?: string;
  summary: MessageExecutionSummary | null;
  isStreaming: boolean;
  canRegenerate: boolean;
  rating?: MessageRating;
};

const getMessageRole = (message: ConversationMessage): "user" | "assistant" | "system" => {
  const role = (message.role || message.type || "assistant").toString();
  if (role === "user") return "user";
  if (role === "system") return "system";
  return "assistant";
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

  const rows: ChatRow[] = visibleMessages.map((message, index) => {
    const role = getMessageRole(message);
    const messageId = message.id ?? `${role}-${index}`;

    return {
      key: messageId,
      message,
      messageId,
      role,
      requestMessage: undefined,
      requestContent: undefined,
      summary: role === "assistant" ? getExecutionSummary(message) : null,
      isStreaming: message.id === streamingMessageId,
      canRegenerate: role === "assistant" && messages.slice(0, index).some((item) => getMessageRole(item) === "user"),
      rating: messageRatings[messageId],
    };
  });

  const last = visibleMessages[visibleMessages.length - 1];
  if (last && getMessageRole(last) === "user" && !isSending) {
    const userMessageId = last.id ?? `user-${visibleMessages.length - 1}`;
    const virtualAssistantId = `${VIRTUAL_FAILED_ASSISTANT_PREFIX}${userMessageId}`;
    const virtualMessage: ConversationMessage = {
      type: "assistant",
      subtype: "result",
      role: "assistant",
      id: virtualAssistantId,
      time: last.time,
      content: "请求失败（历史记录未保存回复），可点击重新生成。",
      status: "error",
    };
    rows.push({
      key: `${userMessageId}__${virtualAssistantId}`,
      message: virtualMessage,
      messageId: virtualAssistantId,
      role: "assistant",
      requestMessage: last,
      requestContent: extractText(last.content),
      summary: getExecutionSummary(virtualMessage),
      isStreaming: false,
      canRegenerate: true,
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
    <Flex direction="column" gap={3} pt={8}>
      <ChatInteractionProvider value={chatInteractionContextValue}>
        {rows.map((row, rowIndex) => {
          const isLastRow = rowIndex === rows.length - 1;
          const isUser = row.role === "user";
          const isAssistant = row.role === "assistant";
          const maxWidth = { base: "calc(100% - 12px)", md: "calc(100% - 20px)" };

          return (
            <Flex
              key={row.key}
              justify={isUser ? "flex-end" : "flex-start"}
              w="full"
              sx={{
                animation: "chatRowReveal 0.24s ease-out",
                "@keyframes chatRowReveal": {
                  from: { opacity: 0, transform: "translateY(8px)" },
                  to: { opacity: 1, transform: "translateY(0)" },
                },
              }}
            >
              <Box maxW={maxWidth} minW={0} w={isUser || isAssistant ? "fit-content" : "full"}>
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
