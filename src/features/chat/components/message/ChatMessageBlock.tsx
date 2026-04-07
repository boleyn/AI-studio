import { Box, Flex } from "@chakra-ui/react";
import { extractText } from "@shared/chat/messages";
import React from "react";
import { useCopyData } from "@/hooks/useCopyData";
import type { ConversationMessage } from "@/types/conversation";
import type { MessageExecutionSummary } from "../../utils/executionSummary";
import ChatItem from "../ChatItem";
import MessageActionBar, { type MessageRating } from "./MessageActionBar";

interface ChatMessageBlockProps {
  message: ConversationMessage;
  messageId: string;
  isStreaming?: boolean;
  summary?: MessageExecutionSummary | null;
  requestMessage?: ConversationMessage;
  requestContent?: string;
  isLatestRun?: boolean;
  rating?: MessageRating;
  canRegenerate?: boolean;
  onRegenerate?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onRate?: (messageId: string, rating: MessageRating) => void;
}

const ChatMessageBlock = ({
  message,
  messageId,
  isStreaming,
  summary,
  requestMessage,
  requestContent,
  isLatestRun,
  rating,
  canRegenerate,
  onRegenerate,
  onDelete,
  onRate,
}: ChatMessageBlockProps) => {
  const { copyData } = useCopyData();
  const isUser = message.role === "user";
  const canShowActions = (message.role === "user" || message.role === "assistant") && !isStreaming;

  return (
    <Flex
      align="flex-start"
      direction="column"
      position="relative"
      w="full"
      zIndex={1}
      sx={{
        ".message-action-anchor": {
          opacity: 0,
          pointerEvents: "auto",
          transition: "opacity 0.18s ease",
        },
        "&:hover .message-action-anchor, .message-action-anchor:hover": {
          opacity: 1,
        },
        "&:hover": {
          zIndex: 40,
        },
      }}
    >
      {canShowActions ? (
        <Box
          className="message-action-anchor"
          position="absolute"
          left={0}
          top={0}
          transform="translateY(calc(-100% - 6px))"
          zIndex={60}
        >
          <MessageActionBar
            canDelete={isUser}
            canRegenerate={isUser && canRegenerate}
            onCopy={() => copyData(extractText(message.content))}
            onDelete={isUser ? () => onDelete?.(messageId) : undefined}
            onRate={isUser ? undefined : (rating) => onRate?.(messageId, rating)}
            onRegenerate={isUser ? () => onRegenerate?.(messageId) : undefined}
            rating={rating}
            showRating={!isUser}
          />
        </Box>
      ) : null}

      <ChatItem
        executionSummary={summary}
        isLatestRun={isLatestRun}
        isStreaming={isStreaming}
        message={message}
        messageId={messageId}
        requestMessage={requestMessage}
        requestContent={requestContent}
      />
    </Flex>
  );
};

export default React.memo(
  ChatMessageBlock,
  (prevProps, nextProps) =>
    prevProps.message === nextProps.message &&
    prevProps.messageId === nextProps.messageId &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.summary?.nodeCount === nextProps.summary?.nodeCount &&
    prevProps.summary?.durationSeconds === nextProps.summary?.durationSeconds &&
    prevProps.requestMessage === nextProps.requestMessage &&
    prevProps.requestContent === nextProps.requestContent &&
    prevProps.isLatestRun === nextProps.isLatestRun &&
    prevProps.rating === nextProps.rating &&
    prevProps.canRegenerate === nextProps.canRegenerate &&
    prevProps.onRegenerate === nextProps.onRegenerate &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.onRate === nextProps.onRate
);
