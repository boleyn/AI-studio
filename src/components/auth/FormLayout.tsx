import { AbsoluteCenter, Box, Flex } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { LoginPageTypeEnum } from "./constants";
import { getFeishuRuntimeConfig } from "@features/auth/client/feishuConfigClient";
import { motion } from "framer-motion";
import AuthModeSwitcher from "./AuthModeSwitcher";

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

  const oAuthList = useMemo(
    () => [
      ...(feishuEnabled && pageType !== LoginPageTypeEnum.feishu
        ? [
            {
              label: "飞书快捷登录",
              icon: "/icons/feishuFill.svg",
              pageType: LoginPageTypeEnum.feishu,
            },
          ]
        : []),
      ...(pageType !== LoginPageTypeEnum.password
        ? [
            {
              label: "账号密码登录",
              icon: "/icons/privateLight.svg",
              pageType: LoginPageTypeEnum.password,
            },
          ]
        : []),
    ],
    [feishuEnabled, pageType]
  );

  const showOauth = oAuthList.length > 0;

  return (
    <Flex flexDirection="column" h="100%">
      {children}
      {showOauth && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          <Box position="relative" mt={6}>
            <Box h="1px" bg="rgba(148,163,184,0.32)" />
            <AbsoluteCenter bg="rgba(255,255,255,0.88)" px={3} color="myGray.500" fontSize="mini">
              或
            </AbsoluteCenter>
          </Box>
          <Box mt={4}>
            <AuthModeSwitcher
              options={oAuthList}
              currentPageType={pageType}
              onChange={setPageType}
            />
          </Box>
        </motion.div>
      )}
    </Flex>
  );
};

export default FormLayout;
