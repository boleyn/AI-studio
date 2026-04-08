import { Box, Button, Card, CardBody, Flex, Grid, Heading, Input, Tab, TabList, Tabs, Text } from "@chakra-ui/react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { useRef, useState } from "react";

import { SearchIcon } from "@components/common/Icon";
import { AccountModelConfigPanel, type AccountModelConfigPanelRef } from "@components/AccountModal/AccountModelConfigPanel";
import { ModelUsageWorkspace } from "@components/workbench/ModelUsageWorkspace";
import { WorkbenchShell } from "@components/workbench/WorkbenchShell";
import { getAuthUserFromRequest } from "@server/auth/ssr";
import { useModelUsage } from "../hooks/useModelUsage";
import { useAuth } from "../contexts/AuthContext";

export default function ModelsPage() {
  const router = useRouter();
  const { user, loading: loadingUser } = useAuth();
  const { data: usageData } = useModelUsage();
  const panelRef = useRef<AccountModelConfigPanelRef>(null);
  const [searchValue, setSearchValue] = useState("");
  const queryTab = Array.isArray(router.query.tab) ? router.query.tab[0] : router.query.tab;
  const usageTab = queryTab === "usage";
  const activeIndex = usageTab ? 1 : 0;

  const formatCompactNumber = (value: number) => {
    if (!Number.isFinite(value)) return "0";
    const units = ["", "K", "M", "B", "T"];
    let current = Math.abs(value);
    let unitIndex = 0;
    while (current >= 1000 && unitIndex < units.length - 1) {
      current /= 1000;
      unitIndex += 1;
    }
    if (unitIndex === 0) return value.toLocaleString("zh-CN");
    const formatted = current >= 100 ? current.toFixed(0) : current >= 10 ? current.toFixed(1) : current.toFixed(2);
    return `${value < 0 ? "-" : ""}${formatted}${units[unitIndex]}`;
  };

  return (
    <WorkbenchShell
      active={usageTab ? "usage" : "models"}
      title="模型工作台"
      description={usageTab ? "按模型维度查看调用次数、Token 消耗和最近使用时间。" : "统一管理模型配置与用量洞察。"}
      user={user}
      loadingUser={loadingUser}
    >
      <Flex direction="column" minH={0} flex={1}>
      <Box mb={8} flexShrink={0}>
        <Grid templateColumns={{ base: "1fr", md: "repeat(3, minmax(0, 1fr))" }} gap={4}>
          <Card borderRadius="2xl" border="1px solid var(--ws-border)" bg="var(--ws-surface-strong)" boxShadow="none" backdropFilter="blur(12px)">
            <CardBody py={4} px={5}>
              <Text fontSize="12px" color="myGray.500" mb={2}>总调用次数</Text>
              <Heading fontSize={{ base: "28px", md: "32px" }} color="primary.500" lineHeight="1">
                {usageData.summary.totalCalls.toLocaleString("zh-CN")}
              </Heading>
            </CardBody>
          </Card>
          <Card borderRadius="2xl" border="1px solid var(--ws-border)" bg="var(--ws-surface-strong)" boxShadow="none" backdropFilter="blur(12px)">
            <CardBody py={4} px={5}>
              <Text fontSize="12px" color="myGray.500" mb={2}>上下文 Token 消耗</Text>
              <Heading fontSize={{ base: "28px", md: "32px" }} color="primary.500" lineHeight="1">
                {formatCompactNumber(usageData.summary.totalUsedTokens)}
              </Heading>
            </CardBody>
          </Card>
          <Card borderRadius="2xl" border="1px solid var(--ws-border)" bg="var(--ws-surface-strong)" boxShadow="none" backdropFilter="blur(12px)">
            <CardBody py={4} px={5}>
              <Text fontSize="12px" color="myGray.500" mb={2}>活跃模型数</Text>
              <Heading fontSize={{ base: "28px", md: "32px" }} color="primary.500" lineHeight="1">
                {usageData.summary.activeModels.toLocaleString("zh-CN")}
              </Heading>
            </CardBody>
          </Card>
        </Grid>
      </Box>

      <Flex mb={6} align={{ base: "stretch", lg: "center" }} justify="space-between" direction={{ base: "column", lg: "row" }} gap={3} flexShrink={0}>
        <Box maxW="100%">
          <Tabs
            variant="unstyled"
            index={activeIndex}
            onChange={(index) => {
              void router.replace(
                {
                  pathname: "/models",
                  query: index === 1 ? { tab: "usage" } : {},
                },
                undefined,
                { shallow: true }
              );
            }}
          >
            <TabList
              bg="myGray.100"
              p={1.5}
              borderRadius="14px"
              border="1px solid"
              borderColor="myGray.150"
              gap={1}
              w="max-content"
            >
              <Tab
                fontWeight="600"
                fontSize="sm"
                color="myGray.600"
                borderRadius="10px"
                px={5}
                py={1.5}
                _selected={{ color: "primary.600", bg: "white", boxShadow: "0 2px 8px -2px rgba(15, 23, 42, 0.08)", borderColor: "myGray.200" }}
                _hover={{ color: "myGray.700", bg: "whiteAlpha.800" }}
                border="1px solid transparent"
                transition="all 0.2s"
              >
                模型列表
              </Tab>
              <Tab
                fontWeight="600"
                fontSize="sm"
                color="myGray.600"
                borderRadius="10px"
                px={5}
                py={1.5}
                _selected={{ color: "primary.600", bg: "white", boxShadow: "0 2px 8px -2px rgba(15, 23, 42, 0.08)", borderColor: "myGray.200" }}
                _hover={{ color: "myGray.700", bg: "whiteAlpha.800" }}
                border="1px solid transparent"
                transition="all 0.2s"
              >
                用量统计
              </Tab>
            </TabList>
          </Tabs>
        </Box>
        {!usageTab ? (
          <Flex gap={3} w={{ base: "100%", lg: "auto" }}>
            <Box position="relative" w={{ base: "100%", lg: "320px" }}>
              <Box as={SearchIcon} w={4} h={4} position="absolute" left={3} top="50%" transform="translateY(-50%)" color="var(--ws-text-subtle)" />
              <Input
                pl={9}
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="搜索模型名称或 ID"
                bg="var(--ws-surface-strong)"
                borderColor="var(--ws-border)"
                backdropFilter="blur(10px)"
                _hover={{ borderColor: "var(--ws-border-strong)" }}
                _focusVisible={{ borderColor: "var(--ws-accent-border)", boxShadow: "0 0 0 3px var(--ws-accent-soft)" }}
              />
            </Box>
            <Button variant="whitePrimary" onClick={() => panelRef.current?.openCreateDrawer()}>
              新增
            </Button>
          </Flex>
        ) : null}
      </Flex>

      <Box flex={1} minH={0} display="flex">
        {usageTab ? (
          <ModelUsageWorkspace />
        ) : (
          <AccountModelConfigPanel
            ref={panelRef}
            hideHeader
            hideToolbar
            fillParent
            searchValue={searchValue}
            onSearchValueChange={setSearchValue}
          />
        )}
      </Box>
      </Flex>
    </WorkbenchShell>
  );
}

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
