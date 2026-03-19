import { useEffect, useState } from "react";
import {
  Avatar,
  Box,
  Flex,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalOverlay,
  Text,
  useToast,
} from "@chakra-ui/react";
import { useAuth } from "../../contexts/AuthContext";
import { AccountInfoPanel } from "./AccountInfoPanel";
import { AccountLogoutConfirm } from "./AccountLogoutConfirm";
import { AccountPasswordPanel } from "./AccountPasswordPanel";

export type AccountPanelTab = "account" | "password" | "logout";

type AccountModalProps = {
  isOpen: boolean;
  onClose: () => void;
  panel?: AccountPanelTab;
};

export function AccountModal({ isOpen, onClose, panel: initialPanel = "account" }: AccountModalProps) {
  const toast = useToast();
  const { user, logout, loadUser } = useAuth();
  const [panel, setPanel] = useState<AccountPanelTab>("account");

  useEffect(() => {
    if (isOpen) {
      setPanel(initialPanel);
    }
  }, [initialPanel, isOpen]);

  const handleLogoutConfirm = () => {
    onClose();
    logout();
  };

  const handlePasswordSuccess = () => {
    toast({ title: "密码已修改", status: "success", duration: 2000 });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="xl">
      <ModalOverlay bg="blackAlpha.400" />
      <ModalContent
        position="relative"
        maxW="860px"
        borderRadius="2xl"
        border="1px solid rgba(255,255,255,0.72)"
        bg="rgba(255,255,255,0.92)"
        backdropFilter="blur(22px)"
        boxShadow="0 28px 56px -30px rgba(15, 23, 42, 0.42)"
        overflow="hidden"
      >
        <IconButton
          aria-label="关闭账号弹窗"
          icon={<Box as="span" fontSize="16px" lineHeight="1">×</Box>}
          size="sm"
          variant="ghost"
          position="absolute"
          top={3}
          right={3}
          borderRadius="12px"
          color="myGray.600"
          border="1px solid transparent"
          _hover={{ bg: "myGray.100", color: "myGray.800", borderColor: "myGray.200" }}
          _active={{ bg: "myGray.150" }}
          onClick={onClose}
        />
        <ModalBody p={0}>
          <Flex direction="column" minH="520px">
            <Flex
              px={6}
              pt={6}
              pb={5}
              align="center"
              justify="space-between"
              borderBottom="1px solid rgba(148,163,184,0.22)"
              bg="linear-gradient(135deg, rgba(225,234,255,0.72) 0%, rgba(247,250,255,0.86) 64%, rgba(235,252,243,0.64) 100%)"
            >
              <Flex align="center" gap={3.5} minW={0}>
                <Avatar
                  size="md"
                  name={user?.displayName || user?.username || "用户"}
                  src={user?.avatar || "/icons/defaultAvatar.svg"}
                />
                <Box minW={0}>
                  <Text fontSize="md" fontWeight="700" color="myGray.800" noOfLines={1}>
                    {user?.displayName || user?.username || "未命名用户"}
                  </Text>
                  <Text fontSize="sm" color="myGray.500" noOfLines={1}>
                    {user?.contact || "普通账户"}
                  </Text>
                </Box>
              </Flex>
              <Text fontSize="xs" color="blue.700" fontWeight="700" letterSpacing="0.06em">
                PROFILE CONSOLE
              </Text>
            </Flex>

            <Flex flex={1} px={6} pb={6}>
              <Box w="100%" p={1}>
                {panel === "account" && (
                  <AccountInfoPanel
                    user={user}
                    onSaved={async () => {
                      await loadUser();
                    }}
                  />
                )}
                {panel === "password" && (
                  <AccountPasswordPanel onSuccess={handlePasswordSuccess} />
                )}
                {panel === "logout" && (
                  <AccountLogoutConfirm
                    onConfirm={handleLogoutConfirm}
                    onCancel={onClose}
                  />
                )}
              </Box>
            </Flex>
          </Flex>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
