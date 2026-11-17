import { Badge, Box, Button, Flex, Grid, Skeleton, SkeletonCircle, Text } from "@chakra-ui/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { EmptyIcon } from "@components/common/Icon";
import { AppSectionCard } from "../ui";
import { useModelUsage, type ModelUsageTrendPoint } from "../../hooks/useModelUsage";

const MotionBox = motion(Box);

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

const formatShortDate = (dateString: string) => {
  const date = new Date(`${dateString}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
};

const resolveModelIconSrc = (icon?: string) => {
  const value = (icon || "").trim();
  if (!value) return "/icons/llms/auto.svg";
  if (value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return `/icons/llms/${value.replace(/^\/+/, "")}`;
};

export type MetricKey = "calls" | "totalUsedTokens" | "avgUsedPercent";

export const metricOptions: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: "calls", label: "调用次数", color: "#0d0d0d" },
  { key: "totalUsedTokens", label: "Token 消耗", color: "#2563eb" },
  { key: "avgUsedPercent", label: "平均利用率", color: "#5d5d5d" },
];

const dayOptions = [7, 14, 30] as const;

type TrendChartProps = {
  points: ModelUsageTrendPoint[];
  metric: MetricKey;
  color: string;
};

export function TrendChart({ points, metric, color }: TrendChartProps) {
  const width = 780;
  const height = 230;
  const paddingX = 26;
  const paddingTop = 18;
  const paddingBottom = 40;
  const innerW = width - paddingX * 2;
  const innerH = height - paddingTop - paddingBottom;

  const values = points.map((point) => point[metric] || 0);
  const maxValue = Math.max(1, ...values);

  const pointsWithXY = points.map((point, index) => {
    const x = paddingX + (points.length <= 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
    const y = paddingTop + innerH - ((point[metric] || 0) / maxValue) * innerH;
    return { point, x, y };
  });

  const linePath = pointsWithXY
    .map((item, index) => `${index === 0 ? "M" : "L"} ${item.x.toFixed(2)} ${item.y.toFixed(2)}`)
    .join(" ");

  const areaPath = `${linePath} L ${paddingX + innerW} ${paddingTop + innerH} L ${paddingX} ${paddingTop + innerH} Z`;
  const lastPoint = pointsWithXY[pointsWithXY.length - 1];
  const lastValue = lastPoint?.point?.[metric] || 0;

  return (
    <Box w="100%" h="100%">
      <Box as="svg" viewBox={`0 0 ${width} ${height}`} w="100%" h="100%">
        {[0.25, 0.5, 0.75, 1].map((tick) => {
          const y = paddingTop + innerH - tick * innerH;
          return <line key={tick} x1={paddingX} y1={y} x2={width - paddingX} y2={y} stroke="#e7edf5" strokeWidth="1" />;
        })}
        <path d={areaPath} fill={color} opacity="0.08" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {pointsWithXY.map(({ point, x, y }, index) => (
          <g key={`${point.date}-${index}`}>
            <circle cx={x} cy={y} r={index === pointsWithXY.length - 1 ? 4.2 : 3.2} fill={color} />
            <text x={x} y={height - 12} textAnchor="middle" fontSize="10" fill="#7f8ba0">
              {formatShortDate(point.date)}
            </text>
          </g>
        ))}
        {lastPoint ? (
          <text x={lastPoint.x} y={lastPoint.y - 10} textAnchor="end" fontSize="11" fill={color} fontWeight="700">
            {metric === "avgUsedPercent" ? `${lastValue.toFixed(1)}%` : formatCompactNumber(lastValue)}
          </text>
        ) : null}
      </Box>
    </Box>
  );
}

export function ModelUsageWorkspace() {
  const [windowDays, setWindowDays] = useState<(typeof dayOptions)[number]>(7);
  const [metric, setMetric] = useState<MetricKey>("calls");
  const { data, loading, refreshing } = useModelUsage(windowDays);
  const [selectedModelId, setSelectedModelId] = useState("");

  useEffect(() => {
    if (data.items.length === 0) {
      setSelectedModelId("");
      return;
    }
    setSelectedModelId((prev) => (prev && data.items.some((item) => item.modelId === prev) ? prev : data.items[0].modelId));
  }, [data.items]);

  const selectedItem = useMemo(
    () => data.items.find((item) => item.modelId === selectedModelId) || data.items[0],
    [data.items, selectedModelId]
  );

  const selectedTrend = useMemo(() => {
    const points = selectedItem ? data.trends[selectedItem.modelId] : undefined;
    if (Array.isArray(points) && points.length > 0) return points;
    return data.trendWindow.map((date) => ({ date, calls: 0, totalUsedTokens: 0, avgUsedPercent: 0 }));
  }, [data.trendWindow, data.trends, selectedItem]);

  const metricColor = metricOptions.find((option) => option.key === metric)?.color || "#32a549";
  const totalCalls = selectedTrend.reduce((sum, point) => sum + point.calls, 0);
  const totalTokens = selectedTrend.reduce((sum, point) => sum + point.totalUsedTokens, 0);
  const avgUtil = selectedTrend.length > 0
    ? selectedTrend.reduce((sum, point) => sum + point.avgUsedPercent, 0) / selectedTrend.length
    : 0;

  return (
    <Flex direction="column" gap={4} flex={1} minH="490px">
      <Box
        flex={1}
        minH={0}
        display="flex"
        flexDirection="column"
      >
        <Flex align="center" justify="space-between" mb={4} pr={8}>
          <Text fontSize="16px" fontWeight="600" color="ink.primary">用量统计</Text>
        </Flex>

        <Flex align="center" justify="space-between" mb={3.5} gap={2} wrap="wrap">
          <Flex bg="surface.sidebar" border="1px solid" borderColor="stroke.subtle" borderRadius="10px" p={0.5}>
            {dayOptions.map((value) => (
              <Button
                key={value}
                size="xs"
                variant="ghost"
                px={3}
                borderRadius="8px"
                fontWeight={windowDays === value ? "600" : "400"}
                color={windowDays === value ? "ink.primary" : "ink.secondary"}
                bg={windowDays === value ? "white" : "transparent"}
                boxShadow={windowDays === value ? "0 1px 2px rgba(0,0,0,0.06)" : "none"}
                onClick={() => setWindowDays(value)}
              >
                {value}天
              </Button>
            ))}
          </Flex>
          <Badge bg="surface.sidebar" color="ink.secondary" border="1px solid" borderColor="stroke.subtle" fontWeight="500" px={2.5} py={1}>
            {refreshing ? "更新中…" : `更新时间 ${formatTime(data.summary.generatedAt)}`}
          </Badge>
        </Flex>

        {loading && data.items.length === 0 ? (
          <Grid templateColumns={{ base: "1fr", xl: "minmax(0, 0.46fr) minmax(0, 0.54fr)" }} gap={5} flex={1} minH={0}>
            <Box pr={1}>
              {Array.from({ length: 5 }).map((_, idx) => (
                <Flex key={idx} align="center" gap={3} p={3} mb={1}>
                  <SkeletonCircle size="7" flexShrink={0} />
                  <Box flex={1}>
                    <Skeleton height="14px" width="48%" borderRadius="6px" mb={1.5} />
                    <Skeleton height="11px" width="32%" borderRadius="6px" />
                  </Box>
                  <Skeleton height="18px" width="36px" borderRadius="999px" />
                </Flex>
              ))}
            </Box>
            <Flex
              direction="column"
              borderLeftWidth={{ base: 0, xl: "1px" }}
              borderLeftStyle="solid"
              borderLeftColor={{ base: "transparent", xl: "stroke.light" }}
              pl={{ base: 0, xl: 5 }}
            >
              <Skeleton height="20px" width="140px" borderRadius="6px" mb={2} />
              <Skeleton height="13px" width="100px" borderRadius="6px" mb={4} />
              <Grid templateColumns="repeat(3, minmax(0, 1fr))" gap={3} mb={4}>
                {Array.from({ length: 3 }).map((_, idx) => (
                  <AppSectionCard key={idx} p={3}>
                    <Skeleton height="11px" width="52px" borderRadius="4px" mb={2} />
                    <Skeleton height="22px" width="60px" borderRadius="6px" />
                  </AppSectionCard>
                ))}
              </Grid>
              <Flex gap={2} mb={4}>
                <Skeleton height="28px" width="76px" borderRadius="999px" />
                <Skeleton height="28px" width="84px" borderRadius="999px" />
                <Skeleton height="28px" width="88px" borderRadius="999px" />
              </Flex>
              <Skeleton flex={1} minH="190px" borderRadius="12px" />
            </Flex>
          </Grid>
        ) : data.items.length === 0 ? (
          <Flex direction="column" align="center" justify="center" py={12} flex={1}>
            <Box mb={4}>
              <Box as={EmptyIcon} w="140px" h="116px" />
            </Box>
            <Text fontSize="sm" color="myGray.500">暂无模型调用记录</Text>
            <Text mt={1} fontSize="xs" color="myGray.400">
              统计基于会话中记录的模型上下文数据（contextWindow）。
            </Text>
          </Flex>
        ) : (
          <Grid templateColumns={{ base: "1fr", xl: "minmax(0, 0.46fr) minmax(0, 0.54fr)" }} gap={5} flex={1} minH={0}>
            <Box minH={0} overflowY="auto" overflowX="hidden" pr={1}>
              {data.items.map((item, index) => {
                const active = selectedItem?.modelId === item.modelId;
                return (
                  <MotionBox
                    key={item.modelId}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: index * 0.015 }}
                    p={3}
                    borderRadius="10px"
                    mb={1}
                    bg={active ? "surface.active" : "transparent"}
                    cursor="pointer"
                    onClick={() => setSelectedModelId(item.modelId)}
                    whileHover={{ x: 2 }}
                  >
                    <Grid templateColumns={{ base: "minmax(0,1fr)", md: "minmax(220px,2fr) 90px 100px 120px" }} gap={3} alignItems="center">
                      <Flex align="center" gap={3} minW={0}>
                        <Box as="img" src={resolveModelIconSrc(item.icon)} w="18px" h="18px" flexShrink={0} />
                        <Box minW={0}>
                          <Text fontSize="sm" fontWeight="700" color="myGray.800" noOfLines={1}>
                            {item.label}
                          </Text>
                          <Text fontSize="xs" color="myGray.500" noOfLines={1}>{item.modelId}</Text>
                        </Box>
                      </Flex>
                      <Badge justifySelf={{ base: "flex-start", md: "center" }} colorScheme={item.scope === "user" ? "green" : item.scope === "system" ? "gray" : "orange"}>
                        {item.scope === "user" ? "自定义" : item.scope === "system" ? "系统" : "未知"}
                      </Badge>
                      <Text fontSize="sm" color="myGray.700" justifySelf={{ base: "flex-start", md: "center" }}>
                        {item.calls.toLocaleString("zh-CN")}
                      </Text>
                      <Text fontSize="sm" color="myGray.700" justifySelf={{ base: "flex-start", md: "center" }}>
                        {formatCompactNumber(item.totalUsedTokens)}
                      </Text>
                    </Grid>
                  </MotionBox>
                );
              })}
            </Box>

            <Flex
              direction="column"
              minH={0}
              borderLeftWidth={{ base: 0, xl: "1px" }}
              borderLeftStyle="solid"
              borderLeftColor={{ base: "transparent", xl: "myGray.100" }}
              pl={{ base: 0, xl: 5 }}
            >
              <AnimatePresence mode="wait">
                <MotionBox
                  key={`${selectedItem?.modelId || "none"}-${windowDays}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22 }}
                  display="flex"
                  flexDirection="column"
                  minH={0}
                  flex={1}
                >
                  <Text fontSize="16px" fontWeight="600" color="ink.primary" lineHeight="1.3">
                    {selectedItem?.label || "模型趋势"}
                  </Text>
                  <Text mt={0.5} fontSize="12px" color="ink.muted">
                    {selectedItem?.modelId || "选择左侧模型查看趋势"}
                  </Text>

                  <Grid templateColumns="repeat(3, minmax(0, 1fr))" gap={3} mt={4}>
                    <AppSectionCard p={3}>
                      <Text fontSize="11px" color="ink.muted">调用总数</Text>
                      <Text mt={1} fontSize="18px" fontWeight="600" color="ink.primary">{totalCalls.toLocaleString("zh-CN")}</Text>
                    </AppSectionCard>
                    <AppSectionCard p={3}>
                      <Text fontSize="11px" color="ink.muted">Token 总量</Text>
                      <Text mt={1} fontSize="18px" fontWeight="600" color="ink.primary">{formatCompactNumber(totalTokens)}</Text>
                    </AppSectionCard>
                    <AppSectionCard p={3}>
                      <Text fontSize="11px" color="ink.muted">平均利用率</Text>
                      <Text mt={1} fontSize="18px" fontWeight="600" color="ink.primary">{avgUtil.toFixed(1)}%</Text>
                    </AppSectionCard>
                  </Grid>

                  <Flex mt={4} gap={2} wrap="wrap">
                    {metricOptions.map((option) => (
                      <Button
                        key={option.key}
                        size="sm"
                        variant="ghost"
                        borderRadius="999px"
                        border="1px solid"
                        borderColor={metric === option.key ? "ink.primary" : "stroke.subtle"}
                        bg={metric === option.key ? "ink.primary" : "transparent"}
                        color={metric === option.key ? "white" : "ink.secondary"}
                        _hover={{ bg: metric === option.key ? "ink.primary" : "surface.hover" }}
                        onClick={() => setMetric(option.key)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </Flex>

                  <Box mt={4} flex={1} minH="260px">
                    <TrendChart points={selectedTrend} metric={metric} color={metricColor} />
                  </Box>
                </MotionBox>
              </AnimatePresence>
            </Flex>
          </Grid>
        )}
      </Box>
    </Flex>
  );
}
