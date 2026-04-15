import { Box, Flex, Text } from "@chakra-ui/react";
import type { AgentTaskSnapshot } from "../../types/chatPanelRuntime";
import type { SubAgentTimelineEvent } from "../../utils/subAgentTimeline";

const STATUS_META: Record<
  AgentTaskSnapshot["status"],
  { label: string; color: string; bg: string; border: string }
> = {
  running: { label: "运行中", color: "green.700", bg: "green.50", border: "green.200" },
  completed: { label: "已完成", color: "blue.700", bg: "blue.50", border: "blue.200" },
  failed: { label: "失败", color: "red.700", bg: "red.50", border: "red.200" },
  closed: { label: "已关闭", color: "myGray.700", bg: "myGray.100", border: "myGray.250" },
};

const formatTaskTitle = (task: AgentTaskSnapshot) => task.name || task.id;

const renderTaskLine = (task: AgentTaskSnapshot) => {
  const meta = STATUS_META[task.status] || STATUS_META.running;
  return (
    <Flex
      align="center"
      bg={meta.bg}
      border="1px solid"
      borderColor={meta.border}
      borderRadius="8px"
      gap={2}
      justify="space-between"
      key={task.id}
      px={2}
      py={1.5}
    >
      <Text color="myGray.800" fontSize="11px" noOfLines={1}>
        {formatTaskTitle(task)}
      </Text>
      <Text color={meta.color} flexShrink={0} fontSize="10px" fontWeight={700}>
        {meta.label}
      </Text>
    </Flex>
  );
};

const SubAgentTimelineCard = ({ event }: { event: SubAgentTimelineEvent }) => {
  const taskSnapshots = Array.isArray(event.taskSnapshots) ? event.taskSnapshots : [];
  return (
    <Box bg="green.50" border="1px solid" borderColor="green.200" borderRadius="10px" p={2.5}>
      <Text color="green.800" fontSize="12px" fontWeight={700} mb={2}>
        子代理事件 · {event.toolName}
      </Text>
      {taskSnapshots.length > 0 ? (
        <Flex direction="column" gap={1.5}>
          {taskSnapshots.map(renderTaskLine)}
        </Flex>
      ) : (
        <Text color="green.700" fontSize="11px">
          已触发子代理操作，等待任务快照返回
        </Text>
      )}
    </Box>
  );
};

export default SubAgentTimelineCard;
