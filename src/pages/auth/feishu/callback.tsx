import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Spinner, Text, VStack } from "@chakra-ui/react";
import { useToast } from "@chakra-ui/react";
import { setAuthToken } from "@features/auth/client/authClient";

const getLastRoute = (raw: string | null) => {
  if (!raw) return "/";
  return raw.includes("?lastRoute=") ? raw.split("?lastRoute=")[0] : raw;
};

const FeishuCallbackPage = () => {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState("正在校验飞书授权...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!router.isReady) return;
    const code = typeof router.query.code === "string" ? router.query.code : "";
    const rawLastRoute = typeof router.query.lastRoute === "string" ? router.query.lastRoute : "/";
    const lastRoute = getLastRoute(rawLastRoute);

    if (!code) {
      setError("缺少授权码");
      return;
    }

    const run = async () => {
      try {
        setStatus("正在创建/登录账号...");
        const response = await fetch("/api/auth/feishu/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { token?: string; error?: string }
          | null;
        if (!response.ok || !payload?.token) {
          throw new Error(payload?.error || "飞书登录失败");
        }

        setAuthToken(payload.token);
        toast({ title: "飞书登录成功", status: "success", duration: 2000 });
        window.location.replace(lastRoute);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "飞书登录失败";
        setError(msg);
      }
    };

    run();
  }, [router, toast]);

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

export default FeishuCallbackPage;
