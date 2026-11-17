import { ModelUsageWorkspace } from "../workbench/ModelUsageWorkspace";
import { keyframes } from "@emotion/react";
import { useEffect, useState } from "react";
import { Box, Button, Flex, Text, useToast } from "@chakra-ui/react";
import { BarChart3, KeyRound, SlidersHorizontal, User } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { AppDialog } from "../ui";
import { AccountInfoPanel } from "./AccountInfoPanel";
import { AccountLogoutConfirm } from "./AccountLogoutConfirm";
import { AccountModelConfigPanel } from "./AccountModelConfigPanel";
import { AccountPasswordPanel } from "./AccountPasswordPanel";

export type AccountPanelTab = "account" | "password" | "modelConfig" | "logout" | "usage";

type AccountModalProps = {
  isOpen: boolean;
  onClose: () => void;
  panel?: AccountPanelTab;
  showWorkspaceSettings?: boolean;
  /** 独立模式：只展示当前 panel 的专属弹窗，不显示左侧设置导航栏 */
  standalone?: boolean;
};

const panelFadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const PANEL_TITLES: Record<AccountPanelTab, string> = {
  account: "个人资料",
  password: "修改密码",
  modelConfig: "模型配置",
  usage: "用量统计",
  logout: "退出登录",
};

export function AccountModal({
  isOpen,
  onClose,
  panel: initialPanel = "account",
  showWorkspaceSettings = false,
  standalone = true,
}: AccountModalProps) {
  const toast = useToast();
  const { user, logout, loadUser } = useAuth();
  const [panel, setPanel] = useState<AccountPanelTab>("account");

  useEffect(() => {
    if (isOpen) {
      setPanel(initialPanel);
    }
  }, [initialPanel, isOpen]);

  const settingsTabs = [
    { id: "account", label: "账号", icon: User },
    { id: "password", label: "安全与密码", icon: KeyRound },
    { id: "modelConfig", label: "模型配置", icon: SlidersHorizontal },
    { id: "usage", label: "用量统计", icon: BarChart3 },
  ] as const;

  const showSettingsNav = showWorkspaceSettings && !standalone && panel !== "logout";

  const handleLogoutConfirm = () => {
    onClose();
    logout();
  };

  const handlePasswordSuccess = () => {
    toast({ title: "密码已修改", status: "success", duration: 2000 });
    if (standalone) onClose();
  };

  const modalMaxWidth = showSettingsNav
    ? "940px"
    : panel === "logout"
      ? "400px"
      : panel === "password"
        ? "460px"
        : panel === "modelConfig" || panel === "usage"
          ? "900px"
          : "600px";

  return (
    <AppDialog
      isOpen={isOpen}
      onClose={onClose}
      title={panel === "logout" ? PANEL_TITLES.logout : undefined}
      maxW={modalMaxWidth}
      bodyPadding={showSettingsNav ? 0 : "24px"}
    >
      <Flex direction={{ base: "column", md: "row" }} minH={showSettingsNav ? "540px" : undefined}>
        {showSettingsNav && (
          <Flex
            as="nav"
            aria-label="设置"
            direction={{ base: "row", md: "column" }}
            gap={1}
            p={3}
            pt={{ base: 12, md: 5 }}
            minW={{ md: "188px" }}
            flexShrink={0}
            overflowX="auto"
            bg="surface.sidebar"
            borderRight={{ md: "1px solid" }}
            borderBottom={{ base: "1px solid", md: "none" }}
            borderColor="stroke.light"
          >
            <Text
              display={{ base: "none", md: "block" }}
              fontSize="15px"
              fontWeight="600"
              color="ink.primary"
              px={2.5}
              pb={2.5}
            >
              设置
            </Text>
            {settingsTabs.map(({ id, label, icon: Icon }) => {
              const active = panel === id;
              return (
                <Button
                  key={id}
                  size="sm"
                  variant="ghost"
                  justifyContent="flex-start"
                  leftIcon={<Icon size={15} />}
                  borderRadius="10px"
                  px={2.5}
                  py={2}
                  fontWeight={active ? "600" : "400"}
                  color={active ? "ink.primary" : "ink.secondary"}
                  bg={active ? "surface.active" : "transparent"}
                  _hover={{ bg: active ? "surface.active" : "surface.hover" }}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setPanel(id)}
                >
                  {label}
                </Button>
              );
            })}
          </Flex>
        )}

        <Box flex={1} minW={0} bg="surface.canvas">
          {panel === "usage" ? (
            <Box p={showSettingsNav ? 6 : 0} pt={showSettingsNav ? 10 : 0}>
              <ModelUsageWorkspace />
            </Box>
          ) : (
            <Box
              p={showSettingsNav ? 6 : 0}
              pt={showSettingsNav ? 8 : 0}
              display="flex"
              flexDirection="column"
              h="100%"
            >
              <Flex
                direction="column"
                flex="1"
                w="100%"
                key={panel}
                animation={`${panelFadeIn} 180ms ease-out`}
              >
                {panel === "account" && (
                  <AccountInfoPanel
                    user={user}
                    onSaved={async () => {
                      await loadUser();
                    }}
                  />
                )}
                {panel === "password" && <AccountPasswordPanel onSuccess={handlePasswordSuccess} />}
                {panel === "modelConfig" && <AccountModelConfigPanel />}
                {panel === "logout" && <AccountLogoutConfirm onConfirm={handleLogoutConfirm} onCancel={onClose} />}
              </Flex>
            </Box>
          )}
        </Box>
      </Flex>
    </AppDialog>
  );
}
