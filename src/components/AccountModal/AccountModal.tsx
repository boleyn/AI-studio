import { useState } from "react";
import {
  Box,
  Button,
  Flex,
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
};

export function AccountModal({ isOpen, onClose }: AccountModalProps) {
  const toast = useToast();
  const { user, logout } = useAuth();
  const [panel, setPanel] = useState<AccountPanelTab>("account");

  const handleLogoutConfirm = () => {
    onClose();
    logout();
  };

  const handlePasswordSuccess = () => {
    toast({ title: "密码已修改", status: "success", duration: 2000 });
  };

  const menuItems: { key: AccountPanelTab; label: string }[] = [
    { key: "account", label: "账号管理" },
    { key: "password", label: "修改密码" },
    { key: "logout", label: "退出登录" },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="xl">
      <ModalOverlay bg="blackAlpha.400" />
      <ModalContent
        maxW="720px"
        borderRadius="xl"
        border="1px solid rgba(255,255,255,0.65)"
        bg="rgba(255,255,255,0.92)"
        backdropFilter="blur(18px)"
        boxShadow="0px 18px 40px -18px rgba(15, 23, 42, 0.35)"
      >
        <ModalBody p={0}>
          <Flex minH="420px">
            <Box
              w="160px"
              flexShrink={0}
              bg="rgba(255,255,255,0.75)"
              borderRight="1px solid rgba(255,255,255,0.7)"
              py={5}
              px={3}
              borderTopLeftRadius="xl"
              borderBottomLeftRadius="xl"
            >
              <Text fontSize="xs" color="myGray.500" mb={3} px={2} textTransform="uppercase" letterSpacing="wider">
                账号
              </Text>
              <Flex direction="column" gap={0}>
                {menuItems.map(({ key, label }) => (
                  <Button
                    key={key}
                    variant="ghost"
                    size="sm"
                    justifyContent="flex-start"
                    fontWeight="semibold"
                    color="myGray.800"
                    fontSize="sm"
                    borderRadius="md"
                    bg={panel === key ? "myGray.100" : "transparent"}
                    _hover={{ bg: "myGray.100" }}
                    _active={{ bg: "myGray.150" }}
                    onClick={() => setPanel(key)}
                  >
                    {label}
                  </Button>
                ))}
              </Flex>
            </Box>
            <Flex
              flex={1}
              align="center"
              justify="center"
              p={8}
              bg="rgba(255,255,255,0.65)"
              borderTopRightRadius="xl"
              borderBottomRightRadius="xl"
              minH="420px"
            >
              {panel === "account" && <AccountInfoPanel user={user} />}
              {panel === "password" && (
                <AccountPasswordPanel onSuccess={handlePasswordSuccess} />
              )}
              {panel === "logout" && (
                <AccountLogoutConfirm
                  onConfirm={handleLogoutConfirm}
                  onCancel={() => setPanel("account")}
                />
              )}
            </Flex>
          </Flex>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
