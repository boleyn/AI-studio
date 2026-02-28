import { Box, Flex } from "@chakra-ui/react";
import { extractText } from "@shared/chat/messages";
import { useCopyData } from "@/hooks/useCopyData";
import type { ConversationMessage } from "@/types/conversation";
import ChatItem from "../ChatItem";
import MessageActionBar, { type MessageRating } from "./MessageActionBar";

interface ChatMessageBlockProps {
  message: ConversationMessage;
  messageId: string;
  isStreaming?: boolean;
  rating?: MessageRating;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
  onDelete?: () => void;
  onRate?: (rating: MessageRating) => void;
}

const ChatMessageBlock = ({
  message,
  messageId,
  isStreaming,
  rating,
  canRegenerate,
  onRegenerate,
  onDelete,
  onRate,
}: ChatMessageBlockProps) => {
  const { copyData } = useCopyData();
  const isAssistant = message.role === "assistant";
  const canShowActions = isAssistant && !isStreaming;

  return (
    <Flex
      align={message.role === "user" ? "flex-end" : "flex-start"}
      direction="column"
      position="relative"
      w="full"
      sx={{
        ".message-action-anchor": {
          opacity: 0,
          pointerEvents: "auto",
          transition: "opacity 0.18s ease",
        },
        "&:hover .message-action-anchor, .message-action-anchor:hover": {
          opacity: 1,
        },
      }}
    >
      {canShowActions ? (
        <Box
          className="message-action-anchor"
          left={0}
          position="absolute"
          top={0}
          transform="translateY(calc(-100% - 2px))"
          zIndex={3}
        >
          <MessageActionBar
            canDelete
            canRegenerate={canRegenerate}
            onCopy={() => copyData(extractText(message.content))}
            onDelete={onDelete}
            onRate={onRate}
            onRegenerate={onRegenerate}
            rating={rating}
          />
        </Box>
      ) : null}

      <ChatItem isStreaming={isStreaming} message={message} messageId={messageId} />
    </Flex>
  );
};

export default ChatMessageBlock;
