import { Avatar, Box, Flex, Text } from "@chakra-ui/react";
import type { AuthUser } from "../../types/auth";

type AccountInfoPanelProps = {
  user: AuthUser | null;
};

export function AccountInfoPanel({ user }: AccountInfoPanelProps) {
  return (
    <Flex align="center" gap={5} direction="column" textAlign="center">
      <Avatar size="xl" name={user?.username || "用户"} />
      <Box>
        <Text fontSize="lg" fontWeight="semibold" color="myGray.800">
          {user?.username || "未命名用户"}
        </Text>
        <Text fontSize="sm" color="myGray.500" mt={1}>
          {user?.contact ? `账号：${user.contact}` : "普通账户"}
        </Text>
      </Box>
    </Flex>
  );
}
