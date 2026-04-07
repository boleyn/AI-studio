import { Box, Flex } from "@chakra-ui/react";
import {
  CopyIcon,
  DeleteIcon,
  RefreshIcon,
  ThumbDownIcon,
  ThumbUpIcon,
} from "@/components/common/Icon";
import MyTooltip from "@/components/ui/MyTooltip";

type MessageRating = "up" | "down";

interface MessageActionBarProps {
  canRegenerate?: boolean;
  canDelete?: boolean;
  showRating?: boolean;
  rating?: MessageRating;
  onCopy: () => void;
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
  onCopy,
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
      <MyTooltip label="复制">
        <Box
          _hover={{ color: "primary.600" }}
          borderRight="1px solid"
          borderRightColor="myGray.200"
          cursor="pointer"
          onClick={onCopy}
          p="5px"
        >
          <CopyIcon {...iconProps} />
        </Box>
      </MyTooltip>

      {canRegenerate ? (
        <MyTooltip label="重新生成">
          <Box
            _hover={{ color: "primary.600" }}
            borderRight="1px solid"
            borderRightColor="myGray.200"
            cursor="pointer"
            onClick={onRegenerate}
            p="5px"
          >
            <RefreshIcon {...iconProps} />
          </Box>
        </MyTooltip>
      ) : null}

      {canDelete ? (
        <MyTooltip label="删除">
          <Box
            _hover={{ color: "red.600" }}
            borderRight="1px solid"
            borderRightColor="myGray.200"
            cursor="pointer"
            onClick={onDelete}
            p="5px"
          >
            <DeleteIcon {...iconProps} />
          </Box>
        </MyTooltip>
      ) : null}

      {showRating ? (
        <>
          <MyTooltip label="赞">
            <Box
              _hover={{ color: "primary.600" }}
              borderRight="1px solid"
              borderRightColor="myGray.200"
              color={rating === "up" ? "primary.600" : undefined}
              cursor="pointer"
              onClick={() => onRate?.("up")}
              p="5px"
            >
              <ThumbUpIcon {...iconProps} />
            </Box>
          </MyTooltip>

          <MyTooltip label="踩">
            <Box
              _hover={{ color: "yellow.500" }}
              color={rating === "down" ? "yellow.500" : undefined}
              cursor="pointer"
              onClick={() => onRate?.("down")}
              p="5px"
            >
              <ThumbDownIcon {...iconProps} />
            </Box>
          </MyTooltip>
        </>
      ) : null}
    </Flex>
  );
};

export type { MessageRating };
export default MessageActionBar;
