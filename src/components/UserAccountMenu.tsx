import { useState } from "react";
import {
  Avatar,
  Box,
  Flex,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Portal,
  Text,
} from "@chakra-ui/react";
import type { AuthUser } from "../types/auth";
import { AccountModal } from "./AccountModal";
import type { AccountPanelTab } from "./AccountModal";

type UserAccountMenuProps = {
  user: AuthUser | null;
  loadingUser: boolean;
};

const DEFAULT_AVATAR = "/icons/defaultAvatar.svg";
const normalizeAvatar = (value?: string) => {
  const raw = (value || "").trim();
  if (!raw) return DEFAULT_AVATAR;
  if (/^data:image\//i.test(raw)) return DEFAULT_AVATAR;
  return raw;
};

export function UserAccountMenu({ user, loadingUser }: UserAccountMenuProps) {
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountPanel, setAccountPanel] = useState<AccountPanelTab>("account");

  const openAccountModal = (panel: AccountPanelTab = "account") => {
    setAccountPanel(panel);
    setAccountModalOpen(true);
  };

  return (
    <>
      <Menu placement="top-start" gutter={4} matchWidth>
        <MenuButton
          as={Box}
          mt="auto"
          display="block"
          w="100%"
          cursor="pointer"
        >
          <Flex
            direction="row"
            align="center"
            justify="flex-start"
            gap={3}
            p={2.5}
            borderRadius="lg"
            bg="rgba(255,255,255,0.7)"
            border="1px solid var(--ws-border)"
            transition="all 0.15s ease"
            _hover={{ boxShadow: "0 8px 20px rgba(17, 24, 36, 0.08)" }}
            _active={{ transform: "scale(0.995)" }}
          >
            <Avatar
              size="sm"
              flexShrink={0}
              name={user?.displayName || user?.username || "用户"}
              src={normalizeAvatar(user?.avatar)}
            />
            <Flex direction="column" align="flex-start" justify="center" flex="1" minW={0}>
              <Text fontSize="sm" fontWeight="semibold" noOfLines={1}>
                {loadingUser ? "加载中..." : user?.displayName || user?.username || "未命名用户"}
              </Text>
              <Text fontSize="xs" color="myGray.500" noOfLines={1}>
                {user?.contact || "普通账户"}
              </Text>
            </Flex>
          </Flex>
        </MenuButton>
        <Portal>
          <MenuList
            w="100%"
            minW="unset"
            p={1}
            borderRadius="md"
            border="1px solid var(--ws-border)"
            boxShadow="0 12px 24px rgba(17, 24, 36, 0.12)"
          >
            <MenuItem fontSize="sm" px={3} py={2} borderRadius="sm" onClick={() => openAccountModal("account")}>
              账号管理
            </MenuItem>
            <MenuItem fontSize="sm" px={3} py={2} borderRadius="sm" onClick={() => openAccountModal("password")}>
              修改密码
            </MenuItem>
            <MenuItem
              fontSize="sm"
              px={3}
              py={2}
              borderRadius="sm"
              color="red.500"
              _hover={{ bg: "red.50" }}
              onClick={() => openAccountModal("logout")}
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
      />
    </>
  );
}
