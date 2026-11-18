import { Button } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { LoginPageTypeEnum } from "./constants";
import { getFeishuRuntimeConfig } from "@features/auth/client/feishuConfigClient";

const FormLayout = ({
  children,
  setPageType,
  pageType,
}: {
  children: React.ReactNode;
  setPageType: (pageType: LoginPageTypeEnum) => void;
  pageType: LoginPageTypeEnum;
}) => {
  const [feishuEnabled, setFeishuEnabled] = useState(false);

  useEffect(() => {
    let disposed = false;
    getFeishuRuntimeConfig().then((config) => {
      if (disposed) return;
      setFeishuEnabled(Boolean(config.enabled && config.appId));
    });
    return () => {
      disposed = true;
    };
  }, []);

  return (
    <>
      {children}
      {feishuEnabled && pageType !== LoginPageTypeEnum.feishu && (
        <Button mt={5} variant="outline" w="full" minH="46px" borderRadius="12px"
          leftIcon={<img src="/icons/feishuFill.svg" alt="" width="20" height="20" />}
          onClick={() => setPageType(LoginPageTypeEnum.feishu)}>
          使用飞书登录
        </Button>
      )}
      {(pageType === LoginPageTypeEnum.register || pageType === LoginPageTypeEnum.feishu) && (
        <Button mt={3} variant="ghost" w="full" onClick={() => setPageType(LoginPageTypeEnum.password)}>
          返回账号登录
        </Button>
      )}
    </>
  );
};

export default FormLayout;
