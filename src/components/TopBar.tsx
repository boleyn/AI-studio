import { useEffect, useState } from "react";
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
import { EditCustomIcon, SearchIcon, SettingsCustomIcon } from "./common/Icon";
import AsiaInfoLogo from "./auth/AsiaInfoLogo";
import MyTooltip from "./ui/MyTooltip";

type WorkspaceView = "code" | "preview" | "logs";

type TopBarProps = {
  projectName?: string;
  projectDescription?: string;
  onProjectNameChange?: (name: string) => Promise<boolean | void> | boolean | void;
  onProjectDescriptionChange?: (description: string) => Promise<boolean | void> | boolean | void;
  onOpenSettings?: () => void;
  activeView?: WorkspaceView;
  onChangeView?: (view: WorkspaceView) => void;
};

const TopBar = ({
  projectName = "未命名项目",
  projectDescription = "",
  onProjectNameChange,
  onProjectDescriptionChange,
  onOpenSettings,
  activeView = "code",
  onChangeView,
}: TopBarProps) => {
  const toast = useToast();
  const { user, loading: loadingUser } = useAuth();
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountPanel, setAccountPanel] = useState<AccountPanelTab>("account");

  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [draftName, setDraftName] = useState(projectName);
  const [draftDescription, setDraftDescription] = useState(projectDescription);
  const [isSavingMeta, setIsSavingMeta] = useState(false);

  useEffect(() => {
    if (!metaModalOpen) {
      setDraftName(projectName);
      setDraftDescription(projectDescription);
    }
  }, [metaModalOpen, projectDescription, projectName]);

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
          <AsiaInfoLogo showText={false} w="28px" />
          <Text fontSize="24px" lineHeight="1" fontWeight="700" color="#1d2433" noOfLines={1}>
            {projectName || "未命名项目"}
          </Text>
          <MyTooltip label="编辑项目信息">
            <IconButton
              aria-label="编辑项目信息"
              size="sm"
              variant="solid"
              icon={<EditCustomIcon />}
              onClick={() => setMetaModalOpen(true)}
              bg="primary.500"
              color="white"
              borderRadius="999px"
              minW="34px"
              _hover={{ bg: "primary.600", color: "white" }}
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
          <InputGroup maxW="340px">
            <InputLeftElement pointerEvents="none">
              <Box as={SearchIcon} color="myGray.400" boxSize="14px" />
            </InputLeftElement>
            <Input
              placeholder="搜索资源..."
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

          <MyTooltip label="设置">
            <IconButton
              aria-label="设置"
              size="sm"
              variant="ghost"
              icon={<SettingsCustomIcon />}
              onClick={onOpenSettings}
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
                src={user?.avatar || "/icons/defaultAvatar.svg"}
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
