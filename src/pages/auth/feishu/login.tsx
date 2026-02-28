import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Spinner, Text, VStack } from "@chakra-ui/react";
import { useToast } from "@chakra-ui/react";
import { setAuthToken } from "@features/auth/client/authClient";
import { getFeishuRuntimeConfig } from "@features/auth/client/feishuConfigClient";

const FEISHU_JSAPI_URL =
  "https://lf-package-cn.feishucdn.com/obj/feishu-static/lark/passport/jsapi/jsapi.js";

const getLastRoute = (raw: string | null) => {
  if (!raw) return "/";
  return raw.includes("?lastRoute=") ? raw.split("?lastRoute=")[0] : raw;
};

const FeishuAutoLoginPage = () => {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState("正在准备飞书授权...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const rawLastRoute = typeof router.query.lastRoute === "string" ? router.query.lastRoute : "/";
    const lastRoute = getLastRoute(rawLastRoute);

    let disposed = false;

    const loadScript = () =>
      new Promise<void>((resolve, reject) => {
        if (document.querySelector(`script[src=\"${FEISHU_JSAPI_URL}\"]`)) {
          resolve();
          return;
        }
        const script = document.createElement("script");
        script.src = FEISHU_JSAPI_URL;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("飞书 SDK 加载失败"));
        document.head.appendChild(script);
      });

    const requestCode = async (appId: string) => {
      setStatus("正在获取飞书授权码...");
      const tt = (window as any).tt;
      if (tt?.requestAccess || tt?.requestAuthCode) {
        const code = await new Promise<string>((resolve, reject) => {
          if (tt.requestAccess) {
            tt.requestAccess({
              appID: appId,
              scopeList: [],
              success: (res: any) => (res?.code ? resolve(res.code) : reject(new Error("无授权码"))),
              fail: reject,
            });
          } else {
            tt.requestAuthCode({
              appId,
              success: (res: any) => (res?.code ? resolve(res.code) : reject(new Error("无授权码"))),
              fail: reject,
            });
          }
        });
        return code;
      }
      return null;
    };

    const redirectToAuthorize = (appId: string, redirectUri: string) => {
      setStatus("正在跳转飞书授权页...");
      const callbackUrl = `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}lastRoute=${encodeURIComponent(
        lastRoute
      )}`;
      const scope = "contact:contact.base:readonly";
      const authUrl = `https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=${encodeURIComponent(
        appId
      )}&response_type=code&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${encodeURIComponent(
        scope
      )}&state=STATE`;
      window.location.href = authUrl;
    };

    const run = async () => {
      try {
        const config = await getFeishuRuntimeConfig();
        const appId = config.appId;
        const redirectUri = config.redirectUri;

        if (disposed) return;

        if (!appId || !redirectUri) {
          setError("飞书登录未配置");
          return;
        }

        await loadScript();
        const code = await requestCode(appId);
        if (!code) {
          redirectToAuthorize(appId, redirectUri);
          return;
        }
        setStatus("正在验证飞书授权码...");
        const response = await fetch("/api/auth/feishu/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { token?: string; user?: { id: string }; error?: string }
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
        toast({ title: "飞书登录失败", description: msg, status: "error", duration: 3000 });
      }
    };

    if (router.isReady) {
      run();
    }

    return () => {
      disposed = true;
    };
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

export default FeishuAutoLoginPage;
