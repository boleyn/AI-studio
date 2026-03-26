import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Spinner, Text, VStack } from "@chakra-ui/react";

const getLastRoute = (raw: string | null) => {
  if (!raw) return "/";
  return raw.includes("?lastRoute=") ? raw.split("?lastRoute=")[0] : raw;
};

const FeishuAutoLoginPage = () => {
  const router = useRouter();
  const [status, setStatus] = useState("正在跳转飞书授权...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const rawLastRoute = typeof router.query.lastRoute === "string" ? router.query.lastRoute : "/";
    const lastRoute = getLastRoute(rawLastRoute);
    if (!router.isReady) return;
    setStatus("正在跳转飞书授权...");
    const target = `/api/auth/feishu/authorize?lastRoute=${encodeURIComponent(lastRoute)}`;
    window.location.replace(target);
  }, [router]);

  return (
    <Flex minH="100vh" align="center" justify="center" bg="gray.50">
      <Box
        bg="white"
        borderRadius="2xl"
        p={8}
        boxShadow="lg"
        border="1px solid rgba(226,232,240,0.8)"
      >
        <VStack spacing={4}>
          {error ? (
            <>
              <Text fontSize="lg" fontWeight="bold" color="red.500">
                飞书登录失败
              </Text>
              <Text fontSize="sm" color="gray.600" textAlign="center">
                {error}
              </Text>
            </>
          ) : (
            <>
              <Spinner size="lg" color="blue.500" />
              <Text fontSize="md" color="gray.700">
                {status}
              </Text>
            </>
          )}
        </VStack>
      </Box>
    </Flex>
  );
};

export default FeishuAutoLoginPage;
