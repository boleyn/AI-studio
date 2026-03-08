import { Box, Button, Flex, HStack, Text } from "@chakra-ui/react";

type AccountLogoutConfirmProps = {
  onConfirm: () => void;
  onCancel: () => void;
};

export function AccountLogoutConfirm({ onConfirm, onCancel }: AccountLogoutConfirmProps) {
  return (
    <Flex direction="column" align="center" gap={5} textAlign="center" py={6}>
      <Box
        w="64px"
        h="64px"
        borderRadius="full"
        display="flex"
        alignItems="center"
        justifyContent="center"
        bg="radial-gradient(circle at center, rgba(240,68,56,0.22) 0%, rgba(240,68,56,0.1) 56%, rgba(240,68,56,0.02) 100%)"
        border="1px solid rgba(240,68,56,0.28)"
      >
        <Text color="red.600" fontSize="28px" lineHeight="1">!</Text>
      </Box>
      <Text fontSize="xs" textTransform="uppercase" letterSpacing="0.08em" color="myGray.500">
        Session Exit
      </Text>
      <Text fontSize="xl" fontWeight="700" color="myGray.800">
        确定要退出登录吗？
      </Text>
      <Text fontSize="sm" color="myGray.500" maxW="480px">
        退出后你需要重新登录才能继续使用工作台，当前未保存内容可能会丢失。
      </Text>
      <HStack spacing={3} w="100%" justify="center" pt={1}>
        <Button variant="whitePrimary" minW="120px" onClick={onCancel}>
          取消
        </Button>
        <Button
          minW="220px"
          bg="red.500"
          color="white"
          borderRadius="12px"
          boxShadow="0 12px 28px -18px rgba(240,68,56,0.8)"
          _hover={{ bg: "red.600" }}
          onClick={onConfirm}
        >
          确定退出
        </Button>
      </HStack>
    </Flex>
  );
}
