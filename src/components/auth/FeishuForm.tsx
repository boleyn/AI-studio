import { useEffect, useRef } from "react";
import { Box } from "@chakra-ui/react";
import { useToast } from "@chakra-ui/react";
import { LoginPageTypeEnum } from "./constants";
import FormLayout from "./FormLayout";
import { getFeishuRuntimeConfig } from "@features/auth/client/feishuConfigClient";

const FEISHU_SDK_URL =
  "https://lf-package-cn.feishucdn.com/obj/feishu-static/lark/passport/qrcode/LarkSSOSDKWebQRCode-1.0.3.js";

const getLastRoute = (raw: string | null) => {
  if (!raw) return "/";
  return raw.includes("?lastRoute=") ? raw.split("?lastRoute=")[0] : raw;
};

type FeishuFormProps = {
  setPageType: (pageType: LoginPageTypeEnum) => void;
  lastRoute: string;
};

const FeishuForm = ({ setPageType, lastRoute }: FeishuFormProps) => {
  const toast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const qrInstRef = useRef<any>(null);
  const configRef = useRef<{ appId: string; redirectUri: string }>({ appId: "", redirectUri: "" });

  useEffect(() => {
    let disposed = false;

    const handleMessage = (e: MessageEvent) => {
      try {
        const inst = qrInstRef.current;
        if (inst?.matchOrigin && !inst.matchOrigin(e.origin)) return;
        if (inst?.matchData && !inst.matchData(e.data)) return;
        if (!inst?.matchOrigin || !inst?.matchData) {
          const isFeishu = typeof e.origin === "string" && /feishu|lark|feishucdn/i.test(e.origin);
          if (!isFeishu) return;
        }

        const tmpCode = (e.data as any)?.tmp_code;
        if (!tmpCode) return;

        const { appId, redirectUri } = configRef.current;
        if (!appId || !redirectUri) return;

        const callbackUrl = `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}lastRoute=${encodeURIComponent(
          getLastRoute(lastRoute)
        )}`;
        const encodedCallbackUrl = encodeURIComponent(callbackUrl);
        const goto = `https://passport.feishu.cn/suite/passport/oauth/authorize?client_id=${appId}&redirect_uri=${encodedCallbackUrl}&response_type=code&state=STATE`;

        window.location.href = `${goto}&tmp_code=${tmpCode}`;
      } catch (error) {
        console.error("处理飞书登录消息失败:", error);
      }
    };

    const initFeishuLogin = (appId: string, redirectUri: string) => {
      if (!containerRef.current) return;

      const callbackUrl = `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}lastRoute=${encodeURIComponent(
        getLastRoute(lastRoute)
      )}`;
      const encodedCallbackUrl = encodeURIComponent(callbackUrl);
      const goto = `https://passport.feishu.cn/suite/passport/oauth/authorize?client_id=${appId}&redirect_uri=${encodedCallbackUrl}&response_type=code&state=STATE`;

      const QRLoginObj = (window as any).QRLogin({
        id: "feishu_login_container",
        goto,
        width: 300,
        height: 300,
        style: "border:none",
      });
      qrInstRef.current = QRLoginObj;

      window.addEventListener("message", handleMessage);
    };

    const run = async () => {
      const config = await getFeishuRuntimeConfig();
      const appId = config.appId;
      const redirectUri = config.redirectUri;

      if (disposed) return;

      if (!appId || !redirectUri) {
        toast({ status: "error", title: "飞书登录配置缺失" });
        return;
      }

      configRef.current = { appId, redirectUri };

      if (typeof window !== "undefined" && !(window as any).QRLogin) {
        const script = document.createElement("script");
        script.src = FEISHU_SDK_URL;
        script.onload = () => initFeishuLogin(appId, redirectUri);
        script.onerror = () => toast({ status: "error", title: "飞书登录加载失败" });
        document.head.appendChild(script);
      } else if ((window as any).QRLogin) {
        initFeishuLogin(appId, redirectUri);
      }
    };

    run();

    return () => {
      disposed = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("message", handleMessage);
      }
    };
  }, [lastRoute, toast]);

  return (
    <FormLayout setPageType={setPageType} pageType={LoginPageTypeEnum.feishu}>
      <Box>
        <Box w="full" textAlign="center" pt={6} fontWeight="medium">
          使用飞书扫码，快速进入工作台
        </Box>
        <Box p={5} display="flex" w="full" justifyContent="center">
          <div ref={containerRef} id="feishu_login_container" style={{ width: "300px", height: "300px" }} />
        </Box>
      </Box>
    </FormLayout>
  );
};

export default FeishuForm;
