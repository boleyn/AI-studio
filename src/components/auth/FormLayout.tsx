import { AbsoluteCenter, Box, Button, Flex } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { LoginPageTypeEnum } from "./constants";
import Avatar from "./Avatar";
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
        <>
          <Box flex={1} />
          <Box position="relative" mt={6}>
            <Box h="1px" bg="myGray.250" />
            <AbsoluteCenter bg="white" px={3} color="myGray.500" fontSize="mini">
              或
            </AbsoluteCenter>
          </Box>
          <Box mt={4}>
            {oAuthList.map((item) => (
              <Box key={item.label} _notFirst={{ mt: 4 }}>
                <Button
                  variant="whitePrimary"
                  w="100%"
                  h="40px"
                  borderRadius="sm"
                  fontWeight="medium"
                  leftIcon={<Avatar src={item.icon} w="20px" />}
                  onClick={() => setPageType(item.pageType)}
                >
                  {item.label}
                </Button>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Flex>
  );
};

export default FormLayout;
