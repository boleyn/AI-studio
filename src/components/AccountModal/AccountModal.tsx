import { ModelUsageWorkspace } from "../workbench/ModelUsageWorkspace";
import { keyframes } from "@emotion/react";
import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Flex,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalOverlay,
  useToast,
} from "@chakra-ui/react";
import { useAuth } from "../../contexts/AuthContext";
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
};

const panelFadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

export function AccountModal({ isOpen, onClose, panel: initialPanel = "account", showWorkspaceSettings = false }: AccountModalProps) {
  const toast = useToast();
  const { user, logout, loadUser } = useAuth();
  const [panel, setPanel] = useState<AccountPanelTab>("account");

  useEffect(() => {
    if (isOpen) {
      setPanel(initialPanel);
    }
  }, [initialPanel, isOpen]);

  const settingsTabs = [
    { id: "account", label: "账号" },
    { id: "password", label: "密码" },
    { id: "modelConfig", label: "模型配置" },
    { id: "usage", label: "用量统计" },
  ] as const;
  const showSettingsNav = showWorkspaceSettings && panel !== "logout";

  const handleLogoutConfirm = () => {
    onClose();
    logout();
  };

  const handlePasswordSuccess = () => {
    toast({ title: "密码已修改", status: "success", duration: 2000 });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="xl">
      <ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
      <ModalContent
        position="relative"
        maxW={showSettingsNav ? "1060px" : panel === "logout" ? "520px" : (panel === "modelConfig" || panel === "usage") ? "1060px" : "720px"}
        borderRadius="2xl"
        border="1px solid var(--ws-border)"
        bg="var(--ws-surface)"
        backdropFilter="blur(22px)"
        boxShadow="var(--ws-glow-soft, 0 28px 56px -30px rgba(15, 23, 42, 0.42))"
        overflow="hidden"
        maxH={panel === "modelConfig" ? "80vh" : undefined}
        transition="max-width 0.3s ease-out"
      >
        <IconButton
          aria-label="关闭账号弹窗"
          icon={<Box as="span" fontSize="20px" lineHeight="1">×</Box>}
          size="sm"
          variant="ghost"
          position="absolute"
          top={panel === "modelConfig" ? 6 : 4}
          right={panel === "modelConfig" ? 6 : 4}
          borderRadius="12px"
          color="myGray.400"
          border="1px solid"
          borderColor="transparent"
          bg={panel === "modelConfig" ? "white" : "transparent"}
          _hover={{ bg: "red.300", color: "white", borderColor: "red.300" }}
          _active={{ bg: "red.400", color: "white", borderColor: "red.400" }}
          onClick={onClose}
          zIndex={10}
        />
        <ModalBody p={0} maxH="85dvh" overflowY="auto">
          <Flex direction={{ base: "column", md: "row" }}>
            {showSettingsNav && (
              <Flex as="nav" aria-label="设置" direction={{ base: "row", md: "column" }}
                gap={1} p={3} pt={{ base: 12, md: 6 }} minW={{ md: "156px" }}
                flexShrink={0} overflowX="auto" bg="gray.50">
                {settingsTabs.map(({ id, label }) => (
                  <Button key={id} size="sm" variant="ghost" justifyContent="flex-start"
                    aria-current={panel === id ? "page" : undefined}
                    bg={panel === id ? "gray.200" : undefined} onClick={() => setPanel(id)}>
                    {label}
                  </Button>
                ))}
              </Flex>
            )}
            <Box flex={1} minW={0}>
          {panel === "usage" ? <Box p={6} pt={12}><ModelUsageWorkspace /></Box> : (
          <Box
            p={panel === "modelConfig" ? 6 : 8}
            pt={panel === "modelConfig" ? 8 : 10}
            minH={panel === "logout" ? "auto" : panel === "modelConfig" ? "auto" : "560px"}
            display="flex"
            flexDirection="column"
          >
            <Flex
              direction="column"
              flex="1"
              w="100%"
              key={panel}
              animation={`${panelFadeIn} 300ms cubic-bezier(0.22, 1, 0.36, 1)`}
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
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
