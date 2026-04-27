import {
  Box,
  CircularProgress,
  CircularProgressLabel,
  Flex,
  IconButton,
  MenuDivider,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Text,
} from "@chakra-ui/react";
import { useState } from "react";
import MyTooltip from "@/components/ui/MyTooltip";
import ConfirmDialog from "@/components/common/ConfirmDialog";

import { AddIcon, BackIcon, ClockIcon, CloseIcon } from "@/components/common/Icon";
import type { ConversationSummary } from "@/types/conversation";
import type { ContextWindowUsage } from "../types/contextWindow";

interface ChatHeaderProps {
  title?: string;
  messageCount?: number;
  model?: string;
  modelOptions?: Array<{ value: string; label: string }>;
  modelLoading?: boolean;
  onChangeModel?: (model: string) => void;
  conversations?: ConversationSummary[];
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  onDeleteAllConversations?: () => void;
  onRewindLatestTurn?: () => void;
  onReset?: () => void;
  onNewConversation?: () => void;
  onOpenSkills?: () => void;
  contextUsage?: ContextWindowUsage | null;
  contextStatus?: "idle" | "pending" | "ready";
}

const formatTokenCompact = (value?: number): string => {
  if (!Number.isFinite(value)) return "--";
  const normalized = Math.max(0, Number(value));
  if (normalized >= 1_000_000) return `${(normalized / 1_000_000).toFixed(2)}M`;
  if (normalized >= 1_000) return `${(normalized / 1_000).toFixed(1)}k`;
  return `${Math.round(normalized)}`;
};

const ChatHeader = ({
  title,
  messageCount = 0,
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
  onDeleteAllConversations,
  onRewindLatestTurn,
  onReset,
  onNewConversation,
  onOpenSkills: _onOpenSkills,
  contextUsage,
  contextStatus = "idle",
}: ChatHeaderProps) => {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [confirmClearAllOpen, setConfirmClearAllOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const hasUsage = Boolean(contextUsage);
  const isReady = contextStatus === "ready" && !!contextUsage;
  const isPending = contextStatus === "pending";
  const computedUsedPercent = hasUsage && contextUsage && contextUsage.maxContext > 0
    ? (contextUsage.usedTokens / contextUsage.maxContext) * 100
    : 0;
  const usedPercent = Math.min(100, Math.max(0, computedUsedPercent));
  const usedPercentText = usedPercent.toFixed(1);
  const usageState = hasUsage && usedPercent >= 80 ? "danger" : hasUsage && usedPercent >= 60 ? "warning" : "ok";
  const usedTokenText = formatTokenCompact(contextUsage?.usedTokens);
  const maxTokenText = formatTokenCompact(contextUsage?.maxContext);
  const tooltipWithInput = isReady
    ? `${usedTokenText}/${maxTokenText} tokens (${usedPercentText}%)`
    : isPending
    ? hasUsage
      ? `计算中...（${usedTokenText}/${maxTokenText} tokens）`
      : "计算中..."
    : "继续提问后会自动更新";
  const ringColor = usageState === "danger" ? "#EF4444" : usageState === "warning" ? "#F59E0B" : "primary.500";
  const ringTrackColor = usageState === "danger" ? "#FEE2E2" : usageState === "warning" ? "#FEF3C7" : "primary.100";

  const handleConfirmDeleteOne = async () => {
    if (!pendingDeleteId) return;
    setConfirmLoading(true);
    try {
      await Promise.resolve(onDeleteConversation?.(pendingDeleteId));
      setPendingDeleteId(null);
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleConfirmClearAll = async () => {
    setConfirmLoading(true);
    try {
      await Promise.resolve(onDeleteAllConversations?.());
      setConfirmClearAllOpen(false);
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <>
      <Flex
        align="center"
        bg="#f6f8fc"
        borderBottom="1px solid"
        borderColor="#dbe2ec"
        flexShrink={0}
        justify="space-between"
        px={4}
        py={0}
        minH="62px"
      >
      <Box minW={0}>
        <Text color="myGray.800" fontSize="sm" fontWeight="800" maxW="230px" isTruncated>
          {title || "代码助手"}
        </Text>
        <Text color="myGray.500" fontSize="xs" mt={0.5}>
          消息数 {messageCount}
        </Text>
      </Box>

      <Flex align="center" gap={2}>
        <Flex gap={1}>
        <MyTooltip label="撤回上一轮">
          <IconButton
            _hover={{ bg: "myGray.100" }}
            aria-label="撤回上一轮"
            bg="white"
            border="1px solid"
            borderColor="myGray.200"
            borderRadius="10px"
            icon={<BackIcon />}
            onClick={onRewindLatestTurn}
            size="sm"
            variant="ghost"
          />
        </MyTooltip>

        <Menu placement="bottom-end">
          <MyTooltip label="历史对话">
            <MenuButton
              _hover={{ bg: "myGray.100" }}
              aria-label="对话历史"
              as={IconButton}
              borderRadius="10px"
              icon={<ClockIcon />}
              size="sm"
              variant="ghost"
            />
          </MyTooltip>
          <MenuList borderColor="myGray.200" maxH="320px" minW="260px" overflowY="auto" p={1}>
            {conversations.length === 0 ? (
              <MenuItem borderRadius="md" isDisabled>暂无历史对话</MenuItem>
            ) : (
              conversations.map((conversation) => (
                <MenuItem
                  key={conversation.id}
                  bg={conversation.id === activeConversationId ? "blue.50" : "transparent"}
                  borderRadius="md"
                  onClick={() => onSelectConversation?.(conversation.id)}
                >
                  <Flex align="center" gap={2} justify="space-between" w="full">
                    <Text fontWeight={conversation.id === activeConversationId ? "700" : "500"} maxW="184px" isTruncated>
                      {conversation.title || "未命名对话"}
                    </Text>
                    <MyTooltip label="删除这条对话">
                      <IconButton
                        aria-label="删除对话"
                        colorScheme="red"
                        icon={<CloseIcon />}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setPendingDeleteId(conversation.id);
                        }}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        size="xs"
                        variant="ghost"
                      />
                    </MyTooltip>
                  </Flex>
                </MenuItem>
              ))
            )}
            {conversations.length > 0 && (
              <>
                <MenuDivider />
                <MenuItem
                  borderRadius="md"
                  color="red.500"
                  fontWeight="700"
                  onClick={() => {
                    setConfirmClearAllOpen(true);
                  }}
                >
                  清空所有历史记录
                </MenuItem>
              </>
            )}
          </MenuList>
        </Menu>

        <MyTooltip label="新建对话">
          <IconButton
            _hover={{ bg: "myGray.100" }}
            aria-label="新建对话"
            bg="white"
            border="1px solid"
            borderColor="myGray.200"
            borderRadius="10px"
            icon={<AddIcon />}
            onClick={onNewConversation ?? onReset}
            size="sm"
          />
        </MyTooltip>
        </Flex>

        <MyTooltip label={tooltipWithInput}>
          <Flex align="center" direction="column" minW="56px">
            <Box alignItems="center" display="flex" h="32px" justifyContent="center" w="32px">
              <CircularProgress
                color={isPending && !hasUsage ? "#9CA3AF" : ringColor}
                isIndeterminate={isPending && !hasUsage}
                size="32px"
                thickness="12px"
                trackColor={ringTrackColor}
                value={usedPercent}
              >
                <CircularProgressLabel
                  color="#1F2937"
                  fontSize="7.5px"
                  fontWeight="700"
                  lineHeight="1"
                >
                  {hasUsage ? usedPercentText : "--"}
                </CircularProgressLabel>
              </CircularProgress>
            </Box>
          </Flex>
        </MyTooltip>
      </Flex>
      </Flex>
      <ConfirmDialog
        isOpen={Boolean(pendingDeleteId)}
        onClose={() => setPendingDeleteId(null)}
        title="删除对话"
        description="确定要删除这条对话记录吗？此操作不可恢复。"
        confirmText="删除"
        cancelText="取消"
        colorScheme="red"
        onConfirm={handleConfirmDeleteOne}
        isLoading={confirmLoading}
      />
      <ConfirmDialog
        isOpen={confirmClearAllOpen}
        onClose={() => setConfirmClearAllOpen(false)}
        title="清空历史记录"
        description="确定要清空所有历史记录吗？此操作不可恢复。"
        confirmText="清空"
        cancelText="取消"
        colorScheme="red"
        onConfirm={handleConfirmClearAll}
        isLoading={confirmLoading}
      />
    </>
  );
};

export default ChatHeader;
