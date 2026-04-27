import { Box, Button, Flex, VStack, Text } from "@chakra-ui/react";

type AccountLogoutConfirmProps = {
  onConfirm: () => void;
  onCancel: () => void;
};

export function AccountLogoutConfirm({ onConfirm, onCancel }: AccountLogoutConfirmProps) {
  return (
    <Flex h="100%" direction="column" justify="center" align="center" textAlign="center" pb={10}>
      <Box
        w="72px"
        h="72px"
        borderRadius="full"
        display="flex"
        alignItems="center"
        justifyContent="center"
        bg="rgba(240,68,56,0.06)"
        border="1px solid rgba(240,68,56,0.18)"
        mb={8}
        boxShadow="0 0 40px rgba(240,68,56,0.1)"
      >
        <Text color="red.500" fontSize="32px" lineHeight="1" pb={1} fontWeight="300">
          ✕
        </Text>
      </Box>

      <Text fontSize="xs" textTransform="uppercase" letterSpacing="0.1em" color="myGray.400" fontWeight="700">
        Exit Studio Session
      </Text>
      
      <Text mt={4} fontSize="3xl" fontWeight="700" color="myGray.800" maxW="400px" lineHeight="1.2">
        确定要退出登录吗？
      </Text>
      
      <Text mt={4} fontSize="md" color="myGray.500" maxW="380px" lineHeight="1.6">
        退出后你需要重新登录才能继续使用工作台。任何当前未保存的内容可能会丢失。
      </Text>

      <Flex mt={12} gap={4}>
        <Button 
          variant="ghost" 
          size="lg" 
          borderRadius="xl" 
          w="140px" 
          onClick={onCancel}
          _hover={{ bg: "myGray.100" }}
          color="myGray.600"
        >
          取消
        </Button>
        <Button
          size="lg"
          w="180px"
          bg="red.500"
          color="white"
          borderRadius="xl"
          boxShadow="0 8px 20px -8px rgba(240,68,56,0.6)"
          _hover={{ bg: "red.600", transform: "translateY(-1px)" }}
          _active={{ bg: "red.700", transform: "translateY(0)" }}
          transition="all 0.2s"
          onClick={onConfirm}
        >
          确定退出
        </Button>
      </Flex>
    </Flex>
  );
}
