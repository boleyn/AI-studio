import {
  Box,
  Flex,
  IconButton,
  MenuDivider,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Text,
} from "@chakra-ui/react";

import { AddIcon, ClockIcon, CloseIcon, SettingsIcon } from "@/components/common/Icon";
import type { ConversationSummary } from "@/types/conversation";

interface ChatHeaderProps {
  title?: string;
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
}

const ChatHeader = ({
  title,
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
  onDeleteAllConversations,
  onReset,
  onNewConversation,
  onOpenSkills,
}: ChatHeaderProps) => {
  return (
    <Flex
      align="center"
      bg="linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(248,250,252,0.7) 100%)"
      borderBottom="1px solid"
      borderColor="rgba(226,232,240,0.95)"
      flexShrink={0}
      justify="space-between"
      px={4}
      py={3}
    >
      <Box minW={0}>
        <Text color="myGray.800" fontSize="sm" fontWeight="800" maxW="230px" isTruncated>
          {title || "代码助手"}
        </Text>
        <Text color="myGray.500" fontSize="xs" mt={0.5}>
          对话数 {conversations.length}
        </Text>
      </Box>

      <Flex gap={1}>
        {onOpenSkills ? (
          <IconButton
            _hover={{ bg: "myGray.100" }}
            aria-label="技能设置"
            borderRadius="10px"
            icon={<SettingsIcon />}
            onClick={onOpenSkills}
            size="sm"
            variant="ghost"
          />
        ) : null}

        <Menu placement="bottom-end">
          <MenuButton
            _hover={{ bg: "myGray.100" }}
            aria-label="对话历史"
            as={IconButton}
            borderRadius="10px"
            icon={<ClockIcon />}
            size="sm"
            variant="ghost"
          />
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
                    <IconButton
                      aria-label="删除对话"
                      colorScheme="red"
                      icon={<CloseIcon />}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (window.confirm("确定要删除这条对话记录吗？")) {
                          onDeleteConversation?.(conversation.id);
                        }
                      }}
                      size="xs"
                      variant="ghost"
                    />
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
                    if (window.confirm("确定要清空所有历史记录吗？")) {
                      onDeleteAllConversations?.();
                    }
                  }}
                >
                  清空所有历史记录
                </MenuItem>
              </>
            )}
          </MenuList>
        </Menu>

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
      </Flex>
    </Flex>
  );
};

export default ChatHeader;
