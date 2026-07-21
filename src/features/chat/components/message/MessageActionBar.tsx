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
    <Flex
      align="center"
      bg="myWhite.100"
      border="1px solid"
      borderColor="myGray.250"
      borderRadius="10px"
      color="myGray.500"
      boxShadow="sm"
      sx={{
        "& > *:last-child": {
          borderRight: "none",
        },
      }}
    >
      <Box borderRight="1px solid" borderRightColor="myGray.200" px="2px" py="2px">
        <MessageCopyControl content={copyContent} messageType={messageType} />
      </Box>

      {canRegenerate ? (
        <MyTooltip label="重新生成">
          <IconButton
            _hover={{ color: "primary.600" }}
            aria-label="重新生成"
            borderRight="1px solid"
            borderRightColor="myGray.200"
            h="26px"
            icon={<RefreshIcon {...iconProps} />}
            minW="26px"
            onClick={onRegenerate}
            size="xs"
            variant="ghost"
          />
        </MyTooltip>
      ) : null}

      {canDelete ? (
        <MyTooltip label="删除">
          <IconButton
            _hover={{ color: "red.600" }}
            aria-label="删除"
            borderRight="1px solid"
            borderRightColor="myGray.200"
            h="26px"
            icon={<DeleteIcon {...iconProps} />}
            minW="26px"
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
              _hover={{ color: "primary.600", bg: "primary.50" }}
              aria-label="赞"
              borderRight="1px solid"
              borderRightColor="myGray.200"
              bg={rating === "up" ? "primary.50" : "transparent"}
              color={rating === "up" ? "primary.600" : "myGray.500"}
              h="26px"
              icon={<ThumbUpIcon {...iconProps} />}
              minW="26px"
              onClick={() => onRate?.("up")}
              size="xs"
              variant="ghost"
            />
          </MyTooltip>

          <MyTooltip label="踩">
            <IconButton
              _hover={{ color: "orange.600", bg: "orange.50" }}
              aria-label="踩"
              bg={rating === "down" ? "orange.50" : "transparent"}
              color={rating === "down" ? "orange.600" : "myGray.500"}
              h="26px"
              icon={<ThumbDownIcon {...iconProps} />}
              minW="26px"
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
