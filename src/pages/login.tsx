import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Grid, GridItem, Heading, Text, VStack, Link } from "@chakra-ui/react";
import VectorBackground from "../components/auth/VectorBackground";
import AsiaInfoLogo from "../components/auth/AsiaInfoLogo";
import FloatingGraph from "../components/auth/FloatingGraph";
import FeatureFooter from "../components/auth/FeatureFooter";
import LoginForm, { type AuthSuccessPayload } from "../components/auth/LoginForm";
import RegisterForm from "../components/auth/RegisterForm";
import FeishuForm from "../components/auth/FeishuForm";
import ForgetPasswordForm from "../components/auth/ForgetPasswordForm";
import { LoginPageTypeEnum } from "../components/auth/constants";
import { getAuthToken, setAuthToken } from "@features/auth/client/authClient";

const getLastRoute = (value: string | string[] | undefined) => {
  if (!value) return "";
  const raw = Array.isArray(value) ? value[0] : value;
  return raw.includes("?lastRoute=") ? raw.split("?lastRoute=")[0] : raw;
};

const Login = () => {
  const router = useRouter();
  const { lastRoute = "" } = router.query as { lastRoute: string };
  const [pageType, setPageType] = useState<LoginPageTypeEnum>(LoginPageTypeEnum.password);
  const productName = "AI Studio";
  const brandTitle = "AI Studio";
  const brandSubtitle = "MODEL LAB";

  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      router.replace(getLastRoute(lastRoute) || "/");
    }
  }, [lastRoute, router]);

  const loginSuccess = useCallback(
    (res: AuthSuccessPayload) => {
      if (res?.token) {
        setAuthToken(res.token);
      }
      const target = getLastRoute(lastRoute) || "/";
      router.replace(target);
    },
    [lastRoute, router]
  );

  const DynamicComponent = useMemo(() => {
    if (pageType === LoginPageTypeEnum.register) {
      return <RegisterForm setPageType={setPageType} onSuccess={loginSuccess} />;
    }
    if (pageType === LoginPageTypeEnum.feishu) {
      return <FeishuForm setPageType={setPageType} lastRoute={lastRoute || "/"} />;
    }
    if (pageType === LoginPageTypeEnum.forgot) {
      return <ForgetPasswordForm setPageType={setPageType} />;
    }
    return <LoginForm setPageType={setPageType} onSuccess={loginSuccess} />;
  }, [pageType, loginSuccess, lastRoute]);

  return (
    <>
      <VectorBackground />

      <Flex
        alignItems="center"
        justifyContent="center"
        h="100vh"
        position="relative"
        zIndex={1}
        overflow="hidden"
        p={[4, 6]}
        fontFamily="sans-serif"
      >
        <Box w="100%" maxW="1200px" h="85vh" maxH="800px" zIndex={10}>
          <Box
            w="full"
            h="full"
            borderRadius="2rem"
            overflow="hidden"
            boxShadow="0 25px 50px -12px rgba(0,0,0,0.1)"
            border="1px solid rgba(255,255,255,0.5)"
            bg="rgba(255,255,255,0.6)"
            backdropFilter="blur(24px)"
            position="relative"
          >
            <Grid templateColumns={['1fr', '1fr', 'repeat(12, 1fr)']} h="full">
              <GridItem
                colSpan={[12, 12, 7]}
                display={['none', 'none', 'flex']}
                flexDirection="column"
                p={12}
                position="relative"
                bg="transparent"
              >
                <Flex direction="column" h="full" justify="space-between">
                  <VStack align="start" spacing={8} w="full">
                    <Box>
                      <AsiaInfoLogo width="48px" height="48px" showText={true} titleText={brandTitle} subtitleText={brandSubtitle} />
                    </Box>

                    <Box>
                      <Heading
                        size="2xl"
                        fontWeight="extrabold"
                        lineHeight="1.2"
                        mb={4}
                        color="slate.900"
                        letterSpacing="tight"
                        display="flex"
                        alignItems="center"
                        gap={3}
                        flexWrap="nowrap"
                      >
                        <Box as="span" bgClip="text" bgGradient="linear(to-r, blue.600, green.500)" color="transparent">
                          灵感到原型
                        </Box>
                        <Box as="span" color="myGray.800">
                          一步到位
                        </Box>
                      </Heading>
                      <Text color="myGray.600" fontSize="lg" fontWeight="medium" lineHeight="1.6" maxW="xlg">
                        统一管理模型、提示词与评测，把试验、协作和发布放在同一处完成。
                      </Text>
                    </Box>
                  </VStack>

                  <Flex flex={1} alignItems="center" justifyContent="center">
                    <FloatingGraph />
                  </Flex>

                  <Box>
                    <FeatureFooter />
                  </Box>
                </Flex>
              </GridItem>

              <GridItem
                colSpan={[12, 12, 5]}
                position="relative"
                display="flex"
                alignItems="center"
                justifyContent="center"
                bg="rgba(255,255,255,0.7)"
                backdropFilter="blur(40px)"
                borderLeft="1px solid rgba(255,255,255,0.6)"
                boxShadow="-10px 0 30px rgba(0,0,0,0.02)"
              >
                <Box position="absolute" top={8} left={8} display={['block', 'block', 'none']}>
                  <AsiaInfoLogo width="120px" height="30px" titleText={brandTitle} subtitleText={brandSubtitle} />
                </Box>

                <Box w="full" maxW="md" px={6}>
                  <Box mb={8} textAlign="left">
                    <Heading size="lg" mb={2} color="myGray.800">
                      {pageType === LoginPageTypeEnum.register
                        ? "创建新账号"
                        : pageType === LoginPageTypeEnum.feishu
                        ? "飞书快捷登录"
                        : pageType === LoginPageTypeEnum.forgot
                        ? "找回账号"
                        : "继续你的创作"}
                    </Heading>
                    <Text color="myGray.500" fontSize="sm">
                      {pageType === LoginPageTypeEnum.register
                        ? `注册 ${productName} 账号，开启你的实验室`
                        : pageType === LoginPageTypeEnum.feishu
                        ? `使用飞书扫码登录 ${productName}`
                        : pageType === LoginPageTypeEnum.forgot
                        ? `需要帮助？我们会尽快为你找回账号`
                        : `登录 ${productName}，回到你的工作台`}
                    </Text>
                  </Box>
                  <Box w="100%">{DynamicComponent}</Box>
                </Box>

                <Box position="absolute" bottom={6} w="full" textAlign="center">
                  <Flex justify="center" gap={4} fontSize="xs" color="#94a3b8" fontWeight="medium" mb={2}>
                    <Link _hover={{ color: "primary.500", textDecoration: "underline" }} cursor="pointer">
                      功能概览
                    </Link>
                    <Box as="span" color="myGray.250">
                      |
                    </Box>
                    <Link _hover={{ color: "primary.500", textDecoration: "underline" }} cursor="pointer">
                      安全与合规
                    </Link>
                    <Box as="span" color="myGray.250">
                      |
                    </Box>
                    <Link _hover={{ color: "primary.500", textDecoration: "underline" }} cursor="pointer">
                      获取支持
                    </Link>
                  </Flex>
                  <Text fontSize="10px" color="myGray.300" fontFamily="mono" textTransform="uppercase" letterSpacing="wider">
                    © {new Date().getFullYear()} AI Studio
                  </Text>
                </Box>
              </GridItem>
            </Grid>
          </Box>
        </Box>
      </Flex>
    </>
  );
};

export default Login;
