import { Box, Button, Collapse, Flex, Icon, IconButton, Text } from "@chakra-ui/react";
import { ChevronDownIcon } from "@/components/common/Icon";
import Markdown from "@/components/Markdown";
import type { TimelineItem } from "@/features/chat/utils/chatItemParsers";
import { isDetailTruncated, truncateDetailText } from "@/features/chat/utils/chatItemParsers";
import TimelineStatusPill, { type TimelineStatus } from "./TimelineStatusPill";

const HEADER_BTN_SX = {
  borderRadius: "6px",
  _hover: { bg: "myGray.100" },
} as const;
const RESULT_TEXT_SX = {
  fontSize: "11px",
  lineHeight: "18px",
} as const;

const getCompactToolDisplay = (tool: TimelineItem): string => {
  const name = (tool.toolName || "").trim();
  const params = (() => {
    if (!tool.params) return {};
    try {
      const parsed = JSON.parse(tool.params);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  })();
  const path = typeof params.file_path === "string" ? params.file_path : "";
  const tail = path ? path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path : "";
  const pattern = typeof params.pattern === "string" ? params.pattern : "";
  const command = typeof params.command === "string" ? params.command : "";

  if (["Read", "Write", "Edit", "ApplyPatch"].includes(name)) return tail;
  if (["Glob", "Grep"].includes(name)) return pattern;
  if (name === "Bash") return command.length > 40 ? `${command.slice(0, 40)}...` : command;
  return "";
};

const AgentTimelineCard = ({
  item,
  index,
  isStreaming,
  isExpanded,
  onToggle,
  onOpenToolDetailModal,
}: {
  item: TimelineItem;
  index: number;
  isStreaming?: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenToolDetailModal: (title: string, content?: string) => void;
}) => {
  const agentDescription = (item.description || "").trim() || "Running task";
  const agentTypeText = item.agentType || "Agent";
  const agentTitle = `${agentTypeText}: ${agentDescription}`;
  const isRunning =
    item.progressStatus === "in_progress" ||
    item.progressStatus === "pending" ||
    Boolean(isStreaming && item.progressStatus !== "completed" && item.progressStatus !== "error");
  const responseLower = (item.response || "").toLowerCase();
  const hasToolUseErrorPayload =
    responseLower.includes("<tool_use_error>") ||
    responseLower.includes("tool_use_error") ||
    responseLower.includes("file has not been read yet") ||
    responseLower.includes("displayfilepath is not defined");
  const isError = item.progressStatus === "error" || (!isRunning && hasToolUseErrorPayload);
  const isDenied = isError && (responseLower.includes("user denied") || responseLower.includes("denied"));
  const status: TimelineStatus = isRunning ? "running" : isDenied ? "denied" : isError ? "error" : "completed";
  const shouldShowStatusPill = status !== "completed";
  const children = Array.isArray(item.children) ? item.children : [];
  const currentTool = children.find(
    (child) => child.type === "tool" && (child.progressStatus === "in_progress" || child.progressStatus === "pending")
  );
  const responsePreview = truncateDetailText(item.response);
  const responseTruncated = isDetailTruncated(item.response);

  return (
    <Box borderLeft="2px solid" borderLeftColor="myGray.300" key={`agent-${item.id || index}`} pl={3} py={1}>
      <Flex align="center" gap={2}>
        <Box bg="purple.400" borderRadius="full" h="6px" w="6px" />
        <Button
          color="myGray.800"
          fontSize="12px"
          fontWeight={600}
          h="22px"
          minW="auto"
          onClick={onToggle}
          px={1.5}
          size="xs"
          variant="ghost"
          sx={HEADER_BTN_SX}
        >
          Subagent / {agentTitle}
        </Button>
        <Flex align="center" gap={1.5} ml="auto">
          {!isRunning ? (
            <Text color="myGray.600" fontSize="11px" minW="56px" textAlign="right" whiteSpace="nowrap">
              {children.length} tools
            </Text>
          ) : null}
          {shouldShowStatusPill ? <TimelineStatusPill status={status} /> : null}
        </Flex>
        <IconButton
          aria-label={isExpanded ? "收起子 Agent 详情" : "展开子 Agent 详情"}
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
          onClick={onToggle}
          size="xs"
          variant="ghost"
          sx={HEADER_BTN_SX}
        />
      </Flex>

      {!isExpanded && currentTool ? (
        <Flex align="center" color="myGray.600" fontSize="11px" gap={1.5} mt={1}>
          <Text color="myGray.500">Currently:</Text>
          <Text color="myGray.700" fontWeight={600}>{currentTool.toolName || "tool"}</Text>
          {getCompactToolDisplay(currentTool) ? (
            <>
              <Text color="myGray.350">/</Text>
              <Text color="myGray.600" fontFamily="mono" noOfLines={1}>
                {getCompactToolDisplay(currentTool)}
              </Text>
            </>
          ) : null}
        </Flex>
      ) : null}

      <Collapse animateOpacity in={isExpanded}>
        <Flex borderTop="1px dashed" borderColor="myGray.250" direction="column" gap={1.5} mt={1.5} pt={2}>
          {item.prompt ? (
            <Box>
              <Flex align="center" justify="space-between" mb={1}>
                <Text color="purple.700" fontSize="10px" fontWeight="700">
                  Prompt
                </Text>
              </Flex>
              <Markdown source={item.prompt} />
            </Box>
          ) : null}

          {children.length > 0 ? (
            <Flex direction="column" gap={0.5}>
              {children.map((child, childIndex) => (
                <Flex align="center" gap={2} key={`${item.id || index}-child-${child.id || childIndex}`}>
                  <Text color="myGray.500" minW="14px" sx={RESULT_TEXT_SX} textAlign="right">
                    {childIndex + 1}.
                  </Text>
                  <Text color="myGray.700" fontWeight={600} sx={RESULT_TEXT_SX}>
                    {child.toolName || "tool"}
                  </Text>
                  {getCompactToolDisplay(child) ? (
                    <Text color="myGray.600" fontFamily="mono" noOfLines={1} sx={RESULT_TEXT_SX}>
                      {getCompactToolDisplay(child)}
                    </Text>
                  ) : null}
                  {child.progressStatus === "error" ? (
                    <Text color="red.600" sx={RESULT_TEXT_SX}>
                      (error)
                    </Text>
                  ) : null}
                </Flex>
              ))}
            </Flex>
          ) : null}

          {item.response ? (
            <Box>
              <Flex align="center" justify="space-between" mb={1}>
                <Text color="primary.700" fontSize="10px" fontWeight="700">
                  最终结果
                </Text>
                {responseTruncated ? (
                  <Button
                    colorScheme="primary"
                    h="20px"
                    minW="auto"
                    onClick={() => onOpenToolDetailModal(`Subagent · 最终结果`, item.response)}
                    px={2}
                    size="xs"
                    variant="ghost"
                  >
                    查看完整
                  </Button>
                ) : null}
              </Flex>
              <Markdown source={responsePreview} />
            </Box>
          ) : null}
        </Flex>
      </Collapse>
    </Box>
  );
};

export default AgentTimelineCard;
