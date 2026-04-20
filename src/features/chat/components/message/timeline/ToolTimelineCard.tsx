import { Box, Button, Collapse, Flex, Icon, IconButton, Spinner, Text } from "@chakra-ui/react";
import type { TimelineItem } from "@/features/chat/utils/chatItemParsers";
import { isDetailTruncated, truncateDetailText } from "@/features/chat/utils/chatItemParsers";
import { ToolStreamText } from "@/features/chat/hooks/useChatItemViewModel";
import TimelineStatusPill, { type TimelineStatus } from "./TimelineStatusPill";

const parseJsonObject = (value?: string): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
};

const getFileName = (value?: string) => {
  if (!value) return "";
  const normalized = value.replace(/\\/g, "/");
  const tail = normalized.split("/").filter(Boolean).pop();
  return tail || value;
};

const normalizeWorkspaceFilePath = (value?: string): string => {
  const raw = (value || "").trim();
  if (!raw) return "";
  return raw.startsWith("/") ? raw : `/${raw}`;
};

const getGlobFiles = (response?: string): string[] => {
  if (!response) return [];
  try {
    const parsed = JSON.parse(response);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
    if (parsed && typeof parsed === "object") {
      const filenames = (parsed as { filenames?: unknown }).filenames;
      if (Array.isArray(filenames)) {
        return filenames.filter((item): item is string => typeof item === "string");
      }
    }
  } catch {
    // ignore
  }
  return response
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("{") && !line.startsWith("[") && !line.startsWith('"'));
};

const toPreviewLines = (value: string): string[] =>
  value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .slice(0, 80);

const ToolTimelineCard = ({
  item,
  index,
  isStreaming,
  isExpanded,
  onToggle,
  onOpenWorkspaceFile,
  onOpenToolDetailModal,
}: {
  item: TimelineItem;
  index: number;
  isStreaming?: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenWorkspaceFile?: (filePath: string) => boolean;
  onOpenToolDetailModal: (title: string, content?: string) => void;
}) => {
  const normalizedToolName = (item.toolName || "").trim().toLowerCase();
  const toolParams = parseJsonObject(item.params);
  const filePath = typeof toolParams.file_path === "string" ? toolParams.file_path : "";
  const fileName = getFileName(filePath);
  const isReadTool = normalizedToolName === "read";
  const isGlobTool = normalizedToolName === "glob";
  const isEditTool = normalizedToolName === "edit" || normalizedToolName === "apply_patch" || normalizedToolName === "applypatch";
  const isWriteTool = normalizedToolName === "write";
  const leftBorderColor = isReadTool
    ? "gray.400"
    : isGlobTool
    ? "gray.500"
    : isWriteTool
    ? "green.400"
    : isEditTool
    ? "orange.400"
    : "myGray.350";
  const isRunning =
    item.progressStatus === "in_progress" ||
    item.progressStatus === "pending" ||
    Boolean(isStreaming && !item.response);
  const responseRaw = item.response || "";
  const responseLower = responseRaw.toLowerCase();
  const hasToolUseErrorPayload =
    responseLower.includes("<tool_use_error>") ||
    responseLower.includes("tool_use_error") ||
    responseLower.includes("file has not been read yet") ||
    responseLower.includes("displayfilepath is not defined");
  const isError = item.progressStatus === "error" || (!isRunning && hasToolUseErrorPayload);
  const isDenied = isError && (responseLower.includes("user denied") || responseLower.includes("denied"));
  const status: TimelineStatus = isRunning ? "running" : isDenied ? "denied" : isError ? "error" : "completed";
  const shouldShowStatusPill = status !== "completed";
  const workspaceFilePath = normalizeWorkspaceFilePath(filePath);
  const truncatedResponse = truncateDetailText(item.response);
  const responseTruncated = isDetailTruncated(item.response);

  if (isReadTool) {
    return (
      <Box borderLeft="2px solid" borderLeftColor={leftBorderColor} key={`tool-read-${item.id || index}`} pl={3} py={1}>
        <Flex align="center" gap={2}>
          <Text color="myGray.500" fontSize="12px">Read</Text>
          <Text color="myGray.350" fontSize="11px">/</Text>
          <Button
            color="myGray.800"
            fontFamily="mono"
            fontSize="12px"
            h="22px"
            minW="auto"
            onClick={() => {
              if (workspaceFilePath && onOpenWorkspaceFile?.(workspaceFilePath)) {
                return;
              }
              onOpenToolDetailModal(
                `Read · ${fileName || filePath || `工具 ${index + 1}`}`,
                [item.params, item.response].filter(Boolean).join("\n\n")
              );
            }}
            px={1.5}
            size="xs"
            variant="ghost"
          >
            {fileName || filePath || `工具 ${index + 1}`}
          </Button>
          {shouldShowStatusPill ? (
            <Box ml="auto">
              <TimelineStatusPill status={status} />
            </Box>
          ) : (
            <Box ml="auto" />
          )}
        </Flex>
      </Box>
    );
  }

  if (isGlobTool) {
    const globPattern = typeof toolParams.pattern === "string" ? toolParams.pattern : item.params || "";
    const globPath = typeof toolParams.path === "string" ? toolParams.path : "";
    const files = getGlobFiles(item.response);

    return (
      <Box borderLeft="2px solid" borderLeftColor={leftBorderColor} key={`tool-compact-${item.id || index}`} pl={3} py={1}>
        <Flex align="center" gap={2}>
          <Text color="myGray.500" fontSize="12px">Glob</Text>
          <Text color="myGray.350" fontSize="11px">/</Text>
          <Text color="myGray.800" fontFamily="mono" fontSize="12px" noOfLines={1}>
            {globPattern || `工具 ${index + 1}`}
          </Text>
          {globPath ? (
            <Text color="myGray.500" fontSize="11px" fontStyle="italic" noOfLines={1}>
              in {globPath}
            </Text>
          ) : null}
          {shouldShowStatusPill ? (
            <Box ml="auto">
              <TimelineStatusPill status={status} />
            </Box>
          ) : (
            <Box ml="auto" />
          )}
          <IconButton
            aria-label={isExpanded ? "收起结果" : "展开结果"}
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
            onClick={onToggle}
            size="xs"
            variant="ghost"
          />
        </Flex>
        <Collapse animateOpacity in={isExpanded}>
          <Box mt={2}>
            {files.length > 0 ? (
              <Text color="myGray.500" fontSize="11px" mb={1}>
                Found {files.length} {files.length === 1 ? "file" : "files"}
              </Text>
            ) : null}
            {files.length > 0 ? (
              <Flex maxH="148px" overflowY="auto" wrap="wrap">
                {files.slice(0, 120).map((file, fileIndex) => {
                  const displayName = getFileName(file);
                  return (
                    <Box alignItems="center" display="inline-flex" key={`${file}-${fileIndex}`} mr={1}>
                      <Button
                        color="blue.600"
                        fontFamily="mono"
                        fontSize="11px"
                        h="18px"
                        minW="auto"
                        onClick={() => {
                          const normalizedFilePath = normalizeWorkspaceFilePath(file);
                          if (normalizedFilePath && onOpenWorkspaceFile?.(normalizedFilePath)) {
                            return;
                          }
                          onOpenToolDetailModal(`Glob 匹配文件 #${fileIndex + 1}`, file);
                        }}
                        px={0.5}
                        size="xs"
                        title={file}
                        variant="ghost"
                      >
                        {displayName || file}
                      </Button>
                      {fileIndex < Math.min(files.length, 120) - 1 ? (
                        <Text color="myGray.350" fontSize="10px">
                          ,
                        </Text>
                      ) : null}
                    </Box>
                  );
                })}
              </Flex>
            ) : item.response ? (
              <ToolStreamText color="myGray.700" fontSize="12px" isStreaming={isStreaming} value={truncatedResponse} />
            ) : isRunning ? (
              <Text color="myGray.500" fontSize="12px">搜索中...</Text>
            ) : (
              <Text color="myGray.400" fontSize="12px">No files found</Text>
            )}
          </Box>
        </Collapse>
      </Box>
    );
  }

  const toolLabel = isWriteTool ? "Write" : isEditTool ? "Edit" : item.toolName || "工具";
  const title = isWriteTool
    ? fileName || filePath || "新建文件"
    : isEditTool
    ? fileName || filePath || "编辑文件"
    : item.toolName || `工具 ${index + 1}`;
  const oldString = typeof toolParams.old_string === "string" ? toolParams.old_string : "";
  const newString =
    typeof toolParams.new_string === "string"
      ? toolParams.new_string
      : typeof toolParams.content === "string"
      ? toolParams.content
      : "";
  const editWriteDetailContent = [
    filePath ? `file_path: ${filePath}` : "",
    oldString ? `old_string:\n${oldString}` : "",
    newString ? `new_string:\n${newString}` : "",
    item.response ? `tool_result:\n${item.response}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <Box
      key={`tool-${item.id || index}`}
      borderLeft="2px solid"
      borderLeftColor={leftBorderColor}
      py={1}
      pl={3}
    >
      <Flex align="center" gap={2}>
        {isRunning ? (
          <Spinner color="blue.500" size="xs" speed="0.7s" thickness="2.5px" />
        ) : (
          <Box bg="myGray.350" borderRadius="full" h="6px" w="6px" />
        )}
        {(isWriteTool || isEditTool) ? (
          <>
            <Text color="myGray.500" fontSize="12px">{toolLabel}</Text>
            <Text color="myGray.350" fontSize="11px">/</Text>
          </>
        ) : null}
        {isWriteTool || isEditTool ? (
          <Button
            color="myGray.800"
            fontFamily="mono"
            fontSize="12px"
            fontWeight={600}
            h="22px"
            minW="auto"
              onClick={() => {
              if (workspaceFilePath && onOpenWorkspaceFile?.(workspaceFilePath)) {
                return;
              }
              onOpenToolDetailModal(`${item.toolName || "工具"} · ${title}`, editWriteDetailContent);
            }}
            px={1.5}
            size="xs"
            variant="ghost"
          >
            {title}
          </Button>
        ) : (
          <Text color="myGray.800" fontSize="12px" fontWeight="600" noOfLines={1}>
            {title}
          </Text>
        )}
        {shouldShowStatusPill ? (
          <Box ml="auto">
            <TimelineStatusPill status={status} />
          </Box>
        ) : (
          <Box ml="auto" />
        )}
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
          minW="22px"
          onClick={onToggle}
          size="xs"
          variant="ghost"
        />
      </Flex>

      <Collapse animateOpacity in={isExpanded}>
        <Flex direction="column" gap={2} mt={2}>
          {(isEditTool || isWriteTool) && newString ? (
            <Box border="1px solid" borderColor="myGray.200" borderRadius="8px" overflow="hidden">
              <Flex
                align="center"
                bg="myGray.25"
                borderBottom="1px solid"
                borderColor="myGray.200"
                justify="space-between"
                px={2}
                py={1}
              >
                <Text color="myGray.600" fontFamily="mono" fontSize="11px" noOfLines={1}>
                  {filePath || title}
                </Text>
                <Box
                  bg={isWriteTool ? "green.50" : "myGray.50"}
                  border="1px solid"
                  borderColor={isWriteTool ? "green.200" : "myGray.200"}
                  borderRadius="999px"
                  color={isWriteTool ? "green.700" : "myGray.600"}
                  fontSize="10px"
                  px={1.5}
                  py="1px"
                >
                  {isWriteTool ? "New" : "Diff"}
                </Box>
              </Flex>
              <Box fontFamily="mono" fontSize="11px">
                {oldString
                  ? toPreviewLines(oldString).map((line, rowIndex) => (
                      <Flex bg="red.50" key={`old-${rowIndex}`} lineHeight="18px">
                        <Box color="red.500" textAlign="center" w="20px">-</Box>
                        <Text color="red.800" flex="1" px={2} whiteSpace="pre-wrap">
                          {line || " "}
                        </Text>
                      </Flex>
                    ))
                  : null}
                {toPreviewLines(newString).map((line, rowIndex) => (
                  <Flex bg="green.50" key={`new-${rowIndex}`} lineHeight="18px">
                    <Box color="green.500" textAlign="center" w="20px">+</Box>
                    <Text color="green.800" flex="1" px={2} whiteSpace="pre-wrap">
                      {line || " "}
                    </Text>
                  </Flex>
                ))}
              </Box>
            </Box>
          ) : null}

          {!(isEditTool || isWriteTool) || status !== "completed" ? (
            <Box bg="myGray.25" border="1px solid" borderColor="myGray.200" borderRadius="8px" p={2}>
              <Flex align="center" justify="space-between" mb={1}>
                <Text color="primary.700" fontSize="10px" fontWeight="700">
                  结果
                </Text>
                {responseTruncated ? (
                  <Button
                    colorScheme="primary"
                    h="20px"
                    minW="auto"
                    onClick={() => onOpenToolDetailModal(`${item.toolName || `工具 ${index + 1}`} · 出参`, item.response)}
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
                <Text color="myGray.500" fontSize="12px">
                  执行中...
                </Text>
              ) : (
                <Text color="myGray.400" fontSize="12px">
                  暂无输出
                </Text>
              )}
            </Box>
          ) : null}
        </Flex>
      </Collapse>
    </Box>
  );
};

export default ToolTimelineCard;
