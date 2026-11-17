import { useState } from "react";
import {
  Box,
  Button,
  Flex,
  Grid,
  HStack,
  IconButton,
  Text,
  Tooltip,
  useToast,
  VStack,
} from "@chakra-ui/react";
import {
  CalendarClock,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  GitBranch,
  MailCheck,
  PanelLeftClose,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";

type TaskTemplate = {
  id: string;
  title: string;
  description: string;
  icon: typeof CalendarClock;
  iconColor: string;
};

const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "weekly-summary",
    title: "每周工作周报汇总",
    description: "每周五自动整理项目工作成果与进展，输出结构化 Markdown 周报。",
    icon: CalendarClock,
    iconColor: "#16a34a",
  },
  {
    id: "repo-check",
    title: "代码仓库定时巡检",
    description: "定期检查项目构建状态、依赖变更与潜在问题并推送关注摘要。",
    icon: GitBranch,
    iconColor: "#2563eb",
  },
  {
    id: "data-report",
    title: "数据表格定期分析",
    description: "按计划读取工作区报表数据，自动更新趋势图表与 Excel 汇总。",
    icon: FileSpreadsheet,
    iconColor: "#d97706",
  },
  {
    id: "inbox-digest",
    title: "信息监控与日报",
    description: "每天定时收集关注领域的更新动态，整理成简洁摘要发送到会话。",
    icon: MailCheck,
    iconColor: "#7c3aed",
  },
];

type SchedulesViewProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
};

export default function SchedulesView({
  sidebarOpen,
  onToggleSidebar,
}: SchedulesViewProps) {
  const toast = useToast();
  const [showPaused, setShowPaused] = useState(false);

  const handleSelectTemplate = (title: string) => {
    toast({
      title: `已选择模板「${title}」`,
      description: "定时调度后端接口将在后续阶段接入。",
      status: "info",
      duration: 2500,
    });
  };

  return (
    <Flex flex="1" h="100%" minW={0} bg="surface.canvas">
      {/* 定时任务专属次级侧边栏（1:1 对齐 ChatGPT 定时任务页左侧） */}
      {sidebarOpen ? (
        <Flex
          w={{ base: "240px", md: "244px" }}
          flexShrink={0}
          direction="column"
          bg="surface.sidebar"
          borderRight="1px solid"
          borderColor="stroke.light"
        >
          <Flex px={3.5} pt={3} pb={2} align="center" justify="space-between">
            <Text fontWeight="600" fontSize="15px" color="ink.primary">
              定时任务
            </Text>
            <HStack spacing={0.5}>
              <Tooltip label="筛选">
                <IconButton
                  aria-label="筛选定时任务"
                  icon={<SlidersHorizontal size={14} />}
                  size="xs"
                  variant="ghost"
                  color="ink.secondary"
                />
              </Tooltip>
              <Tooltip label="搜索">
                <IconButton
                  aria-label="搜索定时任务"
                  icon={<Search size={14} />}
                  size="xs"
                  variant="ghost"
                  color="ink.secondary"
                />
              </Tooltip>
              <Tooltip label="收起侧边栏">
                <IconButton
                  aria-label="收起侧边栏"
                  icon={<PanelLeftClose size={15} />}
                  size="xs"
                  variant="ghost"
                  color="ink.secondary"
                  onClick={onToggleSidebar}
                />
              </Tooltip>
            </HStack>
          </Flex>

          <Box px={2.5} py={1.5}>
            <Button
              size="sm"
              w="full"
              justifyContent="flex-start"
              fontWeight="500"
              fontSize="13.5px"
              bg="surface.active"
              color="ink.primary"
              borderRadius="10px"
              px={3}
              leftIcon={<Plus size={15} />}
              _hover={{ bg: "surface.active" }}
              onClick={() => handleSelectTemplate("新建定时任务")}
            >
              新建任务
            </Button>
          </Box>

          <Box px={3} pt={3}>
            <HStack
              as="button"
              type="button"
              spacing={1}
              fontSize="12px"
              color="ink.muted"
              cursor="pointer"
              _hover={{ color: "ink.primary" }}
              onClick={() => setShowPaused((v) => !v)}
            >
              <Text>已暂停</Text>
              <Box
                transform={showPaused ? "rotate(90deg)" : "rotate(0deg)"}
                transition="transform 0.15s"
              >
                <ChevronRight size={13} />
              </Box>
            </HStack>
            {showPaused && (
              <Text fontSize="12px" color="ink.muted" mt={2} pl={1}>
                暂无已暂停的任务
              </Text>
            )}
          </Box>
        </Flex>
      ) : null}

      {/* 右侧居中「安排任务」页面（1:1 对齐 ChatGPT 安排任务主区） */}
      <Flex flex="1" h="100%" overflowY="auto" align="center" justify="center" p={{ base: 5, md: 10 }}>
        <VStack maxW="680px" w="full" spacing={7} align="center">
          <VStack spacing={2.5} textAlign="center">
            <Flex
              w="48px"
              h="48px"
              borderRadius="full"
              bg="surface.sidebar"
              border="1px solid"
              borderColor="stroke.subtle"
              align="center"
              justify="center"
            >
              <Clock size={24} color="#5d5d5d" />
            </Flex>
            <Text fontSize="20px" fontWeight="600" color="ink.primary">
              安排任务
            </Text>
            <Text fontSize="13.5px" color="ink.secondary">
              AI Studio 可以帮你处理持续性任务，让你不必亲自动手。
            </Text>
          </VStack>

          <Grid templateColumns={{ base: "1fr", md: "repeat(2, minmax(0, 1fr))" }} gap={3.5} w="full">
            {TASK_TEMPLATES.map((tpl) => {
              const Icon = tpl.icon;
              return (
                <Flex
                  key={tpl.id}
                  as="button"
                  type="button"
                  textAlign="left"
                  align="flex-start"
                  gap={3.5}
                  p={4}
                  borderRadius="16px"
                  bg="white"
                  border="1px solid"
                  borderColor="stroke.subtle"
                  transition="all 0.15s"
                  _hover={{ bg: "surface.sidebar", borderColor: "rgba(0,0,0,0.16)" }}
                  onClick={() => handleSelectTemplate(tpl.title)}
                >
                  <Flex
                    w="32px"
                    h="32px"
                    borderRadius="10px"
                    bg="surface.sidebar"
                    align="center"
                    justify="center"
                    flexShrink={0}
                    mt={0.5}
                  >
                    <Icon size={17} color={tpl.iconColor} />
                  </Flex>
                  <Box minW={0}>
                    <Text fontSize="13.5px" fontWeight="600" color="ink.primary">
                      {tpl.title}
                    </Text>
                    <Text fontSize="12px" color="ink.muted" mt={1} lineHeight="1.5">
                      {tpl.description}
                    </Text>
                  </Box>
                </Flex>
              );
            })}
          </Grid>
        </VStack>
      </Flex>
    </Flex>
  );
}
