import { useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import {
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  Flex,
  Heading,
  HStack,
  Spinner,
  Text,
  useToast,
} from "@chakra-ui/react";

import { clearAuthToken, withAuthHeaders } from "@features/auth/client/authClient";
import { getAuthUserFromRequest } from "@server/auth/ssr";

type AuthUser = {
  id: string;
  username: string;
  contact?: string;
  provider?: string;
};

const AccountPage = () => {
  const router = useRouter();
  const toast = useToast();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          headers: withAuthHeaders(),
        });
        if (!response.ok) {
          throw new Error("获取用户信息失败");
        }
        const data = (await response.json()) as AuthUser;
        setUser(data);
      } catch (error) {
        toast({
          title: "加载失败",
          description: error instanceof Error ? error.message : "未知错误",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      } finally {
        setLoading(false);
      }
    };
    loadUser();
  }, [toast]);

  const handleLogout = async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        throw new Error("退出登录失败");
      }
    } catch (error) {
      toast({
        title: "退出失败",
        description: error instanceof Error ? error.message : "未知错误",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    } finally {
      clearAuthToken();
      router.replace("/login");
    }
  };

  return (
    <Flex minH="100vh" bg="gray.50" px={{ base: 6, lg: 12 }} py={{ base: 8, lg: 10 }}>
      <Box maxW="920px" w="100%" mx="auto">
        <Flex justify="space-between" align={{ base: "flex-start", md: "center" }} mb={8} gap={4}>
          <Box>
            <Heading size="lg" mb={2}>
              账号管理
            </Heading>
            <Text color="gray.600">查看你的账户信息与登录状态。</Text>
          </Box>
          <Button variant="outline" onClick={() => router.push("/")}>
            返回工作台
          </Button>
        </Flex>

        <Card borderRadius="2xl">
          <CardBody>
            {loading ? (
              <Flex justify="center" align="center" minH="220px">
                <Spinner size="lg" />
              </Flex>
            ) : (
              <Flex direction={{ base: "column", md: "row" }} gap={6} align="center">
                <Avatar size="xl" name={user?.username || "用户"} />
                <Box flex="1">
                  <HStack spacing={3} mb={3} flexWrap="wrap">
                    <Heading size="md">{user?.username || "未命名用户"}</Heading>
                    <Badge colorScheme="blue" variant="subtle">
                      {user?.provider === "feishu" ? "飞书登录" : "密码登录"}
                    </Badge>
                  </HStack>
                  <Text color="gray.600" mb={2}>
                    账号：{user?.contact || "未绑定联系方式"}
                  </Text>
                  <Text color="gray.500" fontSize="sm">
                    用户 ID：{user?.id || "-"}
                  </Text>
                </Box>
                <Button colorScheme="red" onClick={handleLogout}>
                  退出登录
                </Button>
              </Flex>
            )}
          </CardBody>
        </Card>
      </Box>
    </Flex>
  );
};

export default AccountPage;

export const getServerSideProps: GetServerSideProps = async (context) => {
  const authUser = getAuthUserFromRequest(context.req);
  if (!authUser) {
    return {
      redirect: {
        destination: `/login?lastRoute=${encodeURIComponent(context.resolvedUrl)}`,
        permanent: false,
      },
    };
  }

  return { props: {} };
};
