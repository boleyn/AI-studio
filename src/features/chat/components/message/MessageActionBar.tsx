import { Box, Flex, IconButton } from "@chakra-ui/react";
import {
  DeleteIcon,
  RefreshIcon,
  ThumbDownIcon,
  ThumbUpIcon,
} from "@/components/common/Icon";
import MyTooltip from "@/components/ui/MyTooltip";
import MessageCopyControl from "./MessageCopyControl";

type MessageRating = "up" | "down";

interface MessageActionBarProps {
  canRegenerate?: boolean;
  canDelete?: boolean;
  showRating?: boolean;
  rating?: MessageRating;
  copyContent: string;
  messageType: "user" | "assistant";
  onRegenerate?: () => void;
  onDelete?: () => void;
  onRate?: (rating: MessageRating) => void;
}

const iconProps = {
  w: "14px",
  h: "14px",
};

const MessageActionBar = ({
  canRegenerate,
  canDelete,
  showRating = true,
  rating,
  copyContent,
  messageType,
  onRegenerate,
  onDelete,
  onRate,
}: MessageActionBarProps) => {
  return (
    <Flex align="center" gap={0.5} color="#71717a" mt={0.5}>
      <MessageCopyControl content={copyContent} messageType={messageType} />

      {canRegenerate ? (
        <MyTooltip label="重新生成">
          <IconButton
            _hover={{ color: "#18181b", bg: "#f4f4f5" }}
            aria-label="重新生成"
            borderRadius="8px"
            color="inherit"
            h="28px"
            icon={<RefreshIcon {...iconProps} />}
            minW="28px"
            onClick={onRegenerate}
            size="xs"
            variant="ghost"
          />
        </MyTooltip>
      ) : null}

      {canDelete ? (
        <MyTooltip label="删除">
          <IconButton
            _hover={{ color: "#dc2626", bg: "#fef2f2" }}
            aria-label="删除"
            borderRadius="8px"
            color="inherit"
            h="28px"
            icon={<DeleteIcon {...iconProps} />}
            minW="28px"
            onClick={onDelete}
            size="xs"
            variant="ghost"
          />
        </MyTooltip>
      ) : null}

      {showRating ? (
        <>
          <MyTooltip label="赞">
            <IconButton
              _hover={{ color: "#18181b", bg: "#f4f4f5" }}
              aria-label="赞"
              bg={rating === "up" ? "#eef4ff" : "transparent"}
              borderRadius="8px"
              color={rating === "up" ? "#2563eb" : "inherit"}
              h="28px"
              icon={<ThumbUpIcon {...iconProps} />}
              minW="28px"
              onClick={() => onRate?.("up")}
              size="xs"
              variant="ghost"
            />
          </MyTooltip>

          <MyTooltip label="踩">
            <IconButton
              _hover={{ color: "#18181b", bg: "#f4f4f5" }}
              aria-label="踩"
              bg={rating === "down" ? "#fff7ed" : "transparent"}
              borderRadius="8px"
              color={rating === "down" ? "#ea580c" : "inherit"}
              h="28px"
              icon={<ThumbDownIcon {...iconProps} />}
              minW="28px"
              onClick={() => onRate?.("down")}
              size="xs"
              variant="ghost"
            />
          </MyTooltip>
        </>
      ) : null}
    </Flex>
  );
};

export type { MessageRating };
export default MessageActionBar;
