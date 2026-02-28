import { Button, Flex, HStack, Text } from "@chakra-ui/react";

type AccountLogoutConfirmProps = {
  onConfirm: () => void;
  onCancel: () => void;
};

export function AccountLogoutConfirm({ onConfirm, onCancel }: AccountLogoutConfirmProps) {
  return (
    <Flex direction="column" align="center" gap={5} textAlign="center">
      <Text fontSize="md" color="myGray.700">
        确定要退出登录吗？
      </Text>
      <HStack spacing={3}>
        <Button variant="whitePrimary" onClick={onCancel}>
          取消
        </Button>
        <Button bg="red.500" color="white" _hover={{ bg: "red.600" }} onClick={onConfirm}>
          确定退出
        </Button>
      </HStack>
    </Flex>
  );
}
