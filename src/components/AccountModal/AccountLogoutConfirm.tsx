import { Button, Flex, Text } from "@chakra-ui/react";

type AccountLogoutConfirmProps = {
  onConfirm: () => void;
  onCancel: () => void;
};

export function AccountLogoutConfirm({ onConfirm, onCancel }: AccountLogoutConfirmProps) {
  return (
    <Flex direction="column" gap={4}>
      <Text fontSize="13.5px" color="ink.secondary" lineHeight="1.6">
        退出后你需要重新登录才能继续使用伯仁 (Bore)。当前未保存的本地编辑可能会丢失。
      </Text>
      <Flex justify="flex-end" gap={2} pt={2}>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirm}>
          退出登录
        </Button>
      </Flex>
    </Flex>
  );
}
