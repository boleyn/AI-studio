import { useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  Flex,
  Grid,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Portal,
  Text,
  Textarea,
  useToast,
} from "@chakra-ui/react";

import { AccountModal } from "./AccountModal";
import type { AccountPanelTab } from "./AccountModal";
import { useAuth } from "@/contexts/AuthContext";
import { AgentSkillsIcon, BackCustomIcon, EditCustomIcon, SearchIcon } from "./common/Icon";
import AsiaInfoLogo from "./auth/AsiaInfoLogo";
import MyTooltip from "./ui/MyTooltip";

type WorkspaceView = "code" | "preview" | "logs";
type SearchConversation = { id: string; title: string };

type TopBarProps = {
  projectName?: string;
  projectDescription?: string;
  onProjectNameChange?: (name: string) => Promise<boolean | void> | boolean | void;
  onProjectDescriptionChange?: (description: string) => Promise<boolean | void> | boolean | void;
  onOpenSettings?: () => void;
  onBack?: () => void;
  activeView?: WorkspaceView;
  onChangeView?: (view: WorkspaceView) => void;
  searchFiles?: string[];
  searchConversations?: SearchConversation[];
  onOpenFileFromSearch?: (filePath: string) => void;
  onOpenConversationFromSearch?: (conversationId: string) => void;
};

const DEFAULT_AVATAR = "/icons/defaultAvatar.svg";
const normalizeAvatar = (value?: string) => {
  const raw = (value || "").trim();
  if (!raw) return DEFAULT_AVATAR;
  if (/^data:image\//i.test(raw)) return DEFAULT_AVATAR;
  return raw;
};

const TopBar = ({
  projectName = "未命名项目",
  projectDescription = "",
  onProjectNameChange,
  onProjectDescriptionChange,
  onOpenSettings,
  onBack,
  activeView = "code",
  onChangeView,
  searchFiles = [],
  searchConversations = [],
  onOpenFileFromSearch,
  onOpenConversationFromSearch,
}: TopBarProps) => {
  const toast = useToast();
  const { user, loading: loadingUser } = useAuth();
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountPanel, setAccountPanel] = useState<AccountPanelTab>("account");

  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [draftName, setDraftName] = useState(projectName);
  const [draftDescription, setDraftDescription] = useState(projectDescription);
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!metaModalOpen) {
      setDraftName(projectName);
      setDraftDescription(projectDescription);
    }
  }, [metaModalOpen, projectDescription, projectName]);

  useEffect(() => {
    if (!searchFocused) return;
    const onClickOutside = (event: MouseEvent) => {
      if (!searchWrapRef.current) return;
      if (searchWrapRef.current.contains(event.target as Node)) return;
      setSearchFocused(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [searchFocused]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matchedFiles = useMemo(() => {
    if (!normalizedQuery) return [];
    return searchFiles
      .filter((path) => path.toLowerCase().includes(normalizedQuery))
      .slice(0, 8);
  }, [normalizedQuery, searchFiles]);
  const matchedConversations = useMemo(() => {
    if (!normalizedQuery) return [];
    return searchConversations
      .filter((item) => item.title.toLowerCase().includes(normalizedQuery))
      .slice(0, 8);
  }, [normalizedQuery, searchConversations]);
  const shouldShowSearchPanel =
    searchFocused && normalizedQuery.length > 0 && (matchedFiles.length > 0 || matchedConversations.length > 0);
  const headerActionButtonProps = {
    size: "sm" as const,
    variant: "solid" as const,
    boxSize: "34px",
    minW: "34px",
    h: "34px",
    p: 0,
    bg: "#eef3ef",
    color: "#2f7a40",
    borderRadius: "9999px",
    border: "1px solid",
    borderColor: "#c9d8ce",
    transition: "all 0.18s ease",
    _hover: { bg: "#32a549", borderColor: "#32a549", color: "white", transform: "translateY(-1px)" },
    _active: { bg: "#2c9140", borderColor: "#2c9140", color: "white", transform: "translateY(0)" },
  };

  const openAccountModal = (panel: AccountPanelTab = "account") => {
    setAccountPanel(panel);
    setAccountModalOpen(true);
  };

  const handleSaveMeta = async () => {
    const nextName = draftName.trim();
    if (!nextName) {
      toast({ title: "项目名称不能为空", status: "error", duration: 2000, isClosable: true });
      return;
    }

    setIsSavingMeta(true);
    try {
      if (nextName !== projectName) {
        await onProjectNameChange?.(nextName);
      }
      if (draftDescription !== projectDescription) {
        await onProjectDescriptionChange?.(draftDescription);
      }
      setMetaModalOpen(false);
    } catch (error) {
      toast({
        title: "保存失败",
        description: error instanceof Error ? error.message : "未知错误",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setIsSavingMeta(false);
    }
  };

  return (
    <Flex
      as="header"
      bg="#f6f8fc"
      mx={0}
      my={0}
      px={4}
      py={0}
      minH="54px"
      align="center"
      zIndex={5}
      borderRadius={0}
      borderBottom="1px solid #dbe2ec"
      boxShadow="none"
    >
      <Grid templateColumns="minmax(0,1fr) auto minmax(0,1fr)" alignItems="center" w="100%" columnGap={4}>
        <Flex align="center" gap={3.5} minW={0} justifySelf="start">
          <MyTooltip label="返回">
            <IconButton
              aria-label="返回"
              icon={<Box as={BackCustomIcon} boxSize="15px" />}
              onClick={() => {
                if (onBack) {
                  onBack();
                  return;
                }
                if (typeof window !== "undefined") {
                  window.history.back();
                }
              }}
              {...headerActionButtonProps}
            />
          </MyTooltip>
          <AsiaInfoLogo showText={false} w="28px" />
          <Text fontSize="24px" lineHeight="1.2" fontWeight="700" color="#1d2433" noOfLines={1}>
            {projectName || "未命名项目"}
          </Text>
          <MyTooltip label="编辑项目信息">
            <IconButton
              aria-label="编辑项目信息"
              icon={<Box as={EditCustomIcon} boxSize="15px" />}
              onClick={() => setMetaModalOpen(true)}
              {...headerActionButtonProps}
            />
          </MyTooltip>
        </Flex>

        <Flex align="center" gap={5} h="64px" justifySelf="center">
          {[
            { key: "code" as const, label: "编辑" },
            { key: "preview" as const, label: "预览" },
            { key: "logs" as const, label: "日志" },
          ].map((tab) => {
            const active = activeView === tab.key;
            return (
              <Box
                key={tab.key}
                as="button"
                type="button"
                onClick={() => onChangeView?.(tab.key)}
                w="92px"
                textAlign="center"
                h="100%"
                borderBottom="2px solid"
                borderColor={active ? "primary.500" : "transparent"}
                color={active ? "primary.700" : "#5d6677"}
                fontWeight={active ? "700" : "500"}
                fontSize="17px"
                lineHeight="1"
                _hover={{ color: active ? "primary.700" : "#303748" }}
              >
                {tab.label}
              </Box>
            );
          })}
        </Flex>

        <Flex align="center" gap={2.5} minW={0} justifySelf="end">
          <Box ref={searchWrapRef} position="relative" maxW="340px" w="100%">
            <InputGroup>
              <InputLeftElement pointerEvents="none">
                <Box as={SearchIcon} color="myGray.400" boxSize="14px" />
              </InputLeftElement>
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                placeholder="搜索文件 / 对话..."
                bg="#f1f3f7"
                border="1px solid"
                borderColor="#edf1f6"
                _hover={{ borderColor: "myGray.300" }}
                _focus={{ borderColor: "primary.400", boxShadow: "0 0 0 3px rgba(100,218,122,0.15)" }}
                h="36px"
                borderRadius="999px"
                fontSize="13px"
              />
            </InputGroup>
            {shouldShowSearchPanel ? (
              <Box
                position="absolute"
                top="calc(100% + 8px)"
                left={0}
                right={0}
                bg="white"
                border="1px solid #dbe2ec"
                borderRadius="12px"
                boxShadow="0 12px 24px -16px rgba(15,23,42,0.35)"
                zIndex={20}
                maxH="320px"
                overflowY="auto"
                p={2}
              >
                {matchedFiles.length > 0 ? (
                  <Box mb={matchedConversations.length > 0 ? 2 : 0}>
                    <Text fontSize="11px" fontWeight="700" color="#64748b" px={2} py={1}>
                      文件
                    </Text>
                    {matchedFiles.map((path) => (
                      <Box
                        key={`file-${path}`}
                        as="button"
                        type="button"
                        onClick={() => {
                          onOpenFileFromSearch?.(path);
                          setSearchFocused(false);
                        }}
                        w="100%"
                        textAlign="left"
                        px={2}
                        py={1.5}
                        borderRadius="8px"
                        fontSize="13px"
                        color="#1f2937"
                        _hover={{ bg: "#eef4ff" }}
                      >
                        {path}
                      </Box>
                    ))}
                  </Box>
                ) : null}
                {matchedConversations.length > 0 ? (
                  <Box>
                    <Text fontSize="11px" fontWeight="700" color="#64748b" px={2} py={1}>
                      对话
                    </Text>
                    {matchedConversations.map((item) => (
                      <Box
                        key={`conv-${item.id}`}
                        as="button"
                        type="button"
                        onClick={() => {
                          onOpenConversationFromSearch?.(item.id);
                          setSearchFocused(false);
                        }}
                        w="100%"
                        textAlign="left"
                        px={2}
                        py={1.5}
                        borderRadius="8px"
                        fontSize="13px"
                        color="#1f2937"
                        _hover={{ bg: "#eef4ff" }}
                      >
                        {item.title || "未命名对话"}
                      </Box>
                    ))}
                  </Box>
                ) : null}
              </Box>
            ) : null}
          </Box>

          <MyTooltip label="agent skills">
            <IconButton
              aria-label="agent skills"
              icon={<Box as={AgentSkillsIcon} boxSize="15px" />}
              onClick={onOpenSettings}
              {...headerActionButtonProps}
            />
          </MyTooltip>

          <Menu placement="bottom-end">
            <MenuButton
              as={Box}
              cursor="pointer"
              borderRadius="full"
              border="1px solid rgba(203,213,225,0.9)"
              p={0.5}
              bg="white"
            >
              <Avatar
                size="sm"
                name={user?.displayName || user?.username || "用户"}
                src={normalizeAvatar(user?.avatar)}
              />
            </MenuButton>
            <Portal>
              <MenuList p={1} minW="180px">
                <MenuItem isDisabled={loadingUser}>
                  <Flex direction="column" minW={0}>
                    <Text fontSize="sm" fontWeight="600" noOfLines={1}>
                      {loadingUser ? "加载中..." : user?.displayName || user?.username || "未命名用户"}
                    </Text>
                    <Text fontSize="xs" color="myGray.500" noOfLines={1}>
                      {user?.contact || "普通账户"}
                    </Text>
                  </Flex>
                </MenuItem>
                <MenuItem fontSize="sm" onClick={() => openAccountModal("account")}>账号管理</MenuItem>
                <MenuItem fontSize="sm" onClick={() => openAccountModal("password")}>修改密码</MenuItem>
                <MenuItem fontSize="sm" color="red.500" _hover={{ bg: "red.50" }} onClick={() => openAccountModal("logout")}>
                  退出登录
                </MenuItem>
              </MenuList>
            </Portal>
          </Menu>
        </Flex>
      </Grid>

      <Modal isOpen={metaModalOpen} onClose={() => setMetaModalOpen(false)} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>编辑项目信息</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text fontSize="sm" color="myGray.600" mb={1}>项目名称</Text>
            <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} mb={4} />
            <Text fontSize="sm" color="myGray.600" mb={1}>项目描述</Text>
            <Textarea
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              minH="120px"
              resize="vertical"
              placeholder="输入项目描述..."
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={2} onClick={() => setMetaModalOpen(false)}>
              取消
            </Button>
            <Button colorScheme="green" onClick={() => void handleSaveMeta()} isLoading={isSavingMeta}>
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <AccountModal
        isOpen={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        panel={accountPanel}
      />
    </Flex>
  );
};

export default TopBar;
