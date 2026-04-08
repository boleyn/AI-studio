import {
  Box,
  Button,
  Card,
  CardBody,
  Flex,
  Grid,
  Heading,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Select,
  Tab,
  TabList,
  Tabs,
  Text,
  useDisclosure,
} from "@chakra-ui/react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { useMemo, useRef, useState } from "react";

import { SearchIcon } from "@components/common/Icon";
import { AccountModelConfigPanel, type AccountModelConfigPanelRef } from "@components/AccountModal/AccountModelConfigPanel";
import { metricOptions, ModelUsageWorkspace, TrendChart, type MetricKey } from "@components/workbench/ModelUsageWorkspace";
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
  const [scopeFilter, setScopeFilter] = useState<"all" | "user" | "system">("all");
  const usageModal = useDisclosure();
  const [usageModel, setUsageModel] = useState<{ modelId: string; label: string; icon?: string } | null>(null);
  const [usageMetric, setUsageMetric] = useState<MetricKey>("calls");
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

  const formatTime = (dateString?: string) => {
    if (!dateString) return "--";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const resolveModelIconSrc = (icon?: string) => {
    const value = (icon || "").trim();
    if (!value) return "/icons/llms/auto.svg";
    if (value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://")) return value;
    return `/icons/llms/${value.replace(/^\/+/, "")}`;
  };

  const selectedUsageItem = useMemo(
    () => usageData.items.find((item) => item.modelId === usageModel?.modelId),
    [usageData.items, usageModel?.modelId]
  );

  const selectedTrend = useMemo(() => {
    if (!usageModel?.modelId) return [];
    const points = usageData.trends[usageModel.modelId];
    if (Array.isArray(points) && points.length > 0) return points;
    return usageData.trendWindow.map((date) => ({ date, calls: 0, totalUsedTokens: 0, avgUsedPercent: 0 }));
  }, [usageData.trendWindow, usageData.trends, usageModel?.modelId]);

  const openUsageModal = (model: { modelId: string; label: string; icon?: string }) => {
    setUsageModel(model);
    setUsageMetric("calls");
    usageModal.onOpen();
  };

  const usageMetricColor = metricOptions.find((option) => option.key === usageMetric)?.color || "#32a549";

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
            <Select
              value={scopeFilter}
              onChange={(event) => setScopeFilter(event.target.value as "all" | "user" | "system")}
              w={{ base: "100%", lg: "140px" }}
              bg="var(--ws-surface-strong)"
              borderColor="var(--ws-border)"
              _hover={{ borderColor: "var(--ws-border-strong)" }}
              _focusVisible={{ borderColor: "var(--ws-accent-border)", boxShadow: "0 0 0 3px var(--ws-accent-soft)" }}
            >
              <option value="all">全部</option>
              <option value="user">自定义</option>
              <option value="system">内置</option>
            </Select>
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
            scopeFilter={scopeFilter}
            onModelClick={openUsageModal}
          />
        )}
      </Box>
      </Flex>

      <Modal isOpen={usageModal.isOpen} onClose={usageModal.onClose} size="4xl" isCentered>
        <ModalOverlay bg="blackAlpha.450" />
        <ModalContent
          borderRadius="2xl"
          border="1px solid var(--ws-border)"
          bg="var(--ws-surface-strong)"
          backdropFilter="blur(14px)"
        >
          <ModalHeader pr={10}>
            <Flex align="center" gap={3}>
              <Box
                as="img"
                src={resolveModelIconSrc(usageModel?.icon)}
                w="30px"
                h="30px"
                borderRadius="10px"
                border="1px solid var(--ws-accent-border)"
                bg="var(--ws-accent-soft)"
              />
              <Box>
                <Text fontSize="lg" fontWeight="800" color="myGray.800" lineHeight="1.2">
                  {usageModel?.label || "模型"}
                </Text>
                <Text fontSize="sm" color="myGray.500">{usageModel?.modelId || "--"}</Text>
              </Box>
            </Flex>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <Grid templateColumns={{ base: "1fr", md: "repeat(4, minmax(0,1fr))" }} gap={3} mb={4}>
              <Box border="1px solid var(--ws-border)" borderRadius="xl" px={4} py={3}>
                <Text fontSize="11px" color="myGray.500" textTransform="uppercase" letterSpacing="0.06em">调用次数</Text>
                <Text mt={1} fontSize="xl" fontWeight="700">{(selectedUsageItem?.calls || 0).toLocaleString("zh-CN")}</Text>
              </Box>
              <Box border="1px solid var(--ws-border)" borderRadius="xl" px={4} py={3}>
                <Text fontSize="11px" color="myGray.500" textTransform="uppercase" letterSpacing="0.06em">Token 消耗</Text>
                <Text mt={1} fontSize="xl" fontWeight="700">{formatCompactNumber(selectedUsageItem?.totalUsedTokens || 0)}</Text>
              </Box>
              <Box border="1px solid var(--ws-border)" borderRadius="xl" px={4} py={3}>
                <Text fontSize="11px" color="myGray.500" textTransform="uppercase" letterSpacing="0.06em">平均利用率</Text>
                <Text mt={1} fontSize="xl" fontWeight="700">{Number(selectedUsageItem?.avgUsedPercent || 0).toFixed(1)}%</Text>
              </Box>
              <Box border="1px solid var(--ws-border)" borderRadius="xl" px={4} py={3}>
                <Text fontSize="11px" color="myGray.500" textTransform="uppercase" letterSpacing="0.06em">最近使用</Text>
                <Text mt={1} fontSize="sm" fontWeight="600">{formatTime(selectedUsageItem?.lastUsedAt)}</Text>
              </Box>
            </Grid>

            <Box border="1px solid var(--ws-border)" borderRadius="xl" px={4} py={3}>
              <Text fontSize="sm" fontWeight="700" color="myGray.700" mb={3}>近 7 天趋势</Text>
              {selectedTrend.length === 0 ? (
                <Text fontSize="sm" color="myGray.500">暂无统计数据</Text>
              ) : (
                <>
                  <Flex mb={3} gap={2} wrap="wrap">
                    {metricOptions.map((option) => (
                      <Button
                        key={option.key}
                        size="sm"
                        variant="ghost"
                        borderRadius="999px"
                        border="1px solid"
                        borderColor={usageMetric === option.key ? "primary.300" : "myGray.200"}
                        bg={usageMetric === option.key ? "primary.50" : "transparent"}
                        color={usageMetric === option.key ? "primary.700" : "myGray.600"}
                        onClick={() => setUsageMetric(option.key)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </Flex>
                  <Box h="280px">
                    <TrendChart points={selectedTrend} metric={usageMetric} color={usageMetricColor} />
                  </Box>
                </>
              )}
            </Box>
          </ModalBody>
        </ModalContent>
      </Modal>
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
