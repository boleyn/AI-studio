import {
  Box,
  CircularProgress,
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

import { AddIcon, ClockIcon, CloseIcon } from "@/components/common/Icon";
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
  onReset?: () => void;
  onNewConversation?: () => void;
  onOpenSkills?: () => void;
  contextUsage?: ContextWindowUsage | null;
  contextStatus?: "idle" | "pending" | "ready";
}

const ChatHeader = ({
  title,
  messageCount = 0,
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
  onDeleteAllConversations,
  onReset,
  onNewConversation,
  onOpenSkills,
  contextUsage,
  contextStatus = "idle",
}: ChatHeaderProps) => {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [confirmClearAllOpen, setConfirmClearAllOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const isReady = contextStatus === "ready" && !!contextUsage;
  const isPending = contextStatus === "pending";
  const usedPercent = Math.min(100, Math.max(0, isReady ? contextUsage.usedPercent || 0 : 0));
  const usedPercentText = usedPercent.toFixed(1);
  const remainingPercentText = Math.max(0, 100 - usedPercent).toFixed(1);
  const tooltipWithInput = isReady
    ? `背景信息窗口（已计算）：\n${usedPercentText}% 已用（剩余 ${remainingPercentText}%）\n已用 ${contextUsage.usedTokens.toLocaleString()} 标记，共 ${contextUsage.maxContext.toLocaleString()}`
    : isPending
    ? "背景信息窗口：计算中...\n正在分析当前对话上下文。"
    : "背景信息窗口：暂未获得统计\n继续提问后会自动更新。";

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
          对话数 {messageCount}
        </Text>
      </Box>

      <Flex align="center" gap={2}>
        <MyTooltip label={tooltipWithInput}>
          <Box alignItems="center" display="flex" h="28px" justifyContent="center" w="28px">
            <CircularProgress
              color={
                isPending
                  ? "blue.400"
                  : usedPercent >= 90
                  ? "red.400"
                  : usedPercent >= 70
                  ? "orange.400"
                  : "gray.300"
              }
              isIndeterminate={isPending}
              size="18px"
              thickness="14px"
              trackColor="gray.100"
              value={usedPercent}
            />
          </Box>
        </MyTooltip>

        <Flex gap={1}>
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
