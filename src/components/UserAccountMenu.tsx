import { useState } from "react";
import {
  Avatar,
  Box,
  Flex,
  HStack,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  Portal,
  Text,
  Tooltip,
} from "@chakra-ui/react";
import {
  BarChart3,
  ChevronRight,
  KeyRound,
  LogOut,
  SlidersHorizontal,
} from "lucide-react";
import type { AuthUser } from "../types/auth";
import { AccountModal } from "./AccountModal";
import type { AccountPanelTab } from "./AccountModal";

type UserAccountMenuProps = {
  user: AuthUser | null;
  loadingUser: boolean;
  showWorkspaceSettings?: boolean;
  compact?: boolean;
};

const DEFAULT_AVATAR = "/icons/defaultAvatar.svg";
const normalizeAvatar = (value?: string) => {
  const raw = (value || "").trim();
  if (!raw) return DEFAULT_AVATAR;
  if (/^data:image\//i.test(raw)) return DEFAULT_AVATAR;
  return raw;
};

export function UserAccountMenu({
  user,
  loadingUser,
  showWorkspaceSettings,
  compact = false,
}: UserAccountMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountPanel, setAccountPanel] = useState<AccountPanelTab>("account");
  const [standaloneModal, setStandaloneModal] = useState(false);

  const openAccountModal = (panel: AccountPanelTab = "account", standalone = false) => {
    setAccountPanel(panel);
    setStandaloneModal(standalone);
    setAccountModalOpen(true);
  };

  const displayName = loadingUser
    ? "加载中..."
    : user?.displayName || user?.username || "未命名用户";
  const subLabel = user?.contact || "个人账户";

  return (
    <>
      <Menu
        isOpen={menuOpen}
        placement="top-start"
        offset={compact ? [8, 8] : [0, 8]}
        onOpen={() => setMenuOpen(true)}
        onClose={() => setMenuOpen(false)}
        autoSelect={false}
      >
        {compact ? (
          <Tooltip label={displayName} placement="right" openDelay={400} isDisabled={menuOpen}>
            <MenuButton
              as={Box}
              display="flex"
              alignItems="center"
              justifyContent="center"
              w="34px"
              h="34px"
              borderRadius="full"
              cursor="pointer"
              transition="background 0.15s ease"
              bg={menuOpen ? "surface.active" : "transparent"}
              _hover={{ bg: "surface.active" }}
            >
              <Avatar
                size="xs"
                w="26px"
                h="26px"
                name={displayName}
                src={normalizeAvatar(user?.avatar)}
              />
            </MenuButton>
          </Tooltip>
        ) : (
          <MenuButton as={Box} mt="auto" display="block" w="100%" cursor="pointer">
            <Flex
              direction="row"
              align="center"
              justify="flex-start"
              gap={2.5}
              p={2}
              borderRadius="12px"
              _hover={{ bg: "surface.hover" }}
            >
              <Avatar size="sm" w="28px" h="28px" name={displayName} src={normalizeAvatar(user?.avatar)} />
              <Box flex="1" minW={0}>
                <Text fontSize="13px" fontWeight="500" color="ink.primary" noOfLines={1}>
                  {displayName}
                </Text>
                <Text fontSize="11px" color="ink.muted" noOfLines={1}>
                  {subLabel}
                </Text>
              </Box>
            </Flex>
          </MenuButton>
        )}

        <Portal>
          <MenuList w="224px" p="6px" borderRadius="18px" zIndex={1500}>
            <Box
              as="button"
              type="button"
              w="full"
              textAlign="left"
              px={2.5}
              py={2}
              borderRadius="12px"
              transition="background 0.12s"
              _hover={{ bg: "surface.hover" }}
              onClick={() => {
                setMenuOpen(false);
                openAccountModal("account", true);
              }}
            >
              <HStack spacing={2.5} w="full" justify="space-between">
                <HStack spacing={2.5} minW={0}>
                  <Avatar
                    size="sm"
                    w="30px"
                    h="30px"
                    flexShrink={0}
                    name={displayName}
                    src={normalizeAvatar(user?.avatar)}
                  />
                  <Box minW={0}>
                    <Text fontSize="13.5px" fontWeight="500" color="ink.primary" noOfLines={1}>
                      {displayName}
                    </Text>
                    <Text fontSize="11.5px" color="ink.muted" noOfLines={1}>
                      {subLabel}
                    </Text>
                  </Box>
                </HStack>
                <ChevronRight size={14} color="#8f8f8f" />
              </HStack>
            </Box>

            <MenuDivider />

            <MenuItem
              fontSize="13.5px"
              iconSpacing={2.5}
              px={2.5}
              py={2}
              icon={<SlidersHorizontal size={15} color="#0d0d0d" />}
              onClick={() => openAccountModal("modelConfig", true)}
            >
              模型配置
            </MenuItem>
            <MenuItem
              fontSize="13.5px"
              iconSpacing={2.5}
              px={2.5}
              py={2}
              icon={<BarChart3 size={15} color="#0d0d0d" />}
              onClick={() => openAccountModal("usage", true)}
            >
              用量统计
            </MenuItem>
            <MenuItem
              fontSize="13.5px"
              iconSpacing={2.5}
              px={2.5}
              py={2}
              icon={<KeyRound size={15} color="#0d0d0d" />}
              onClick={() => openAccountModal("password", true)}
            >
              修改密码
            </MenuItem>

            <MenuDivider />

            <MenuItem
              fontSize="13.5px"
              iconSpacing={2.5}
              px={2.5}
              py={2}
              icon={<LogOut size={15} />}
              color="#dc2626"
              _hover={{ bg: "red.50" }}
              onClick={() => openAccountModal("logout", true)}
            >
              退出登录
            </MenuItem>
          </MenuList>
        </Portal>
      </Menu>

      <AccountModal
        isOpen={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        panel={accountPanel}
        showWorkspaceSettings={showWorkspaceSettings}
        standalone={standaloneModal}
      />
    </>
  );
}
