import { Box, Flex, Text } from "@chakra-ui/react";
import {
  AGENT_STATUS_META,
  SESSION_TASK_STATUS_META,
  type AgentTaskSnapshot,
  type SessionTaskSnapshot,
} from "../types/chatPanelRuntime";

const ChatRuntimePanels = ({
  agentTasks,
  sessionTasks,
  showAgentTasks,
  showSessionTasks,
  agentTaskFilter,
  sessionTaskFilter,
  filteredAgentTaskList,
  filteredSessionTaskList,
  onSetAgentTaskFilter,
  onSetSessionTaskFilter,
  onToggleShowAgentTasks,
  onToggleShowSessionTasks,
  onClearCompletedSessionTasks,
}: {
  agentTasks: Record<string, AgentTaskSnapshot>;
  sessionTasks: Record<string, SessionTaskSnapshot>;
  showAgentTasks: boolean;
  showSessionTasks: boolean;
  agentTaskFilter: "all" | "active" | "done" | "failed";
  sessionTaskFilter: "all" | "active" | "done" | "blocked";
  filteredAgentTaskList: AgentTaskSnapshot[];
  filteredSessionTaskList: SessionTaskSnapshot[];
  onSetAgentTaskFilter: (value: "all" | "active" | "done" | "failed") => void;
  onSetSessionTaskFilter: (value: "all" | "active" | "done" | "blocked") => void;
  onToggleShowAgentTasks: () => void;
  onToggleShowSessionTasks: () => void;
  onClearCompletedSessionTasks: () => void;
}) => {
  return (
    <>
      {Object.keys(agentTasks).length > 0 ? (
        <Box bg="white" border="1px solid" borderColor="myGray.200" borderRadius="10px" mb={3} px={3} py={2}>
          <Flex align="center" justify="space-between" mb={showAgentTasks ? 2 : 0}>
            <Text color="myGray.700" fontSize="12px" fontWeight={700}>
              子代理任务 ({Object.keys(agentTasks).length})
            </Text>
            <Flex align="center" gap={3}>
              {([
                ["all", "全部"],
                ["active", "运行中"],
                ["failed", "失败"],
                ["done", "已结束"],
              ] as Array<["all" | "active" | "done" | "failed", string]>).map(([value, label]) => (
                <Text
                  key={`agent-task-filter-${value}`}
                  as="button"
                  color={agentTaskFilter === value ? "primary.700" : "myGray.500"}
                  fontSize="11px"
                  fontWeight={agentTaskFilter === value ? 700 : 500}
                  onClick={() => onSetAgentTaskFilter(value)}
                >
                  {label}
                </Text>
              ))}
              <Text as="button" color="myGray.500" fontSize="11px" onClick={onToggleShowAgentTasks}>
                {showAgentTasks ? "收起" : "展开"}
              </Text>
            </Flex>
          </Flex>
          {showAgentTasks ? (
            <Flex direction="column" gap={1.5}>
              {filteredAgentTaskList.map((task) => {
                const statusMeta = AGENT_STATUS_META[task.status] || AGENT_STATUS_META.completed;
                return (
                  <Flex
                    key={task.id}
                    align="center"
                    bg="myGray.50"
                    border="1px solid"
                    borderColor="myGray.150"
                    borderRadius="8px"
                    gap={2}
                    px={2}
                    py={1.5}
                  >
                    <Text color="myGray.700" fontSize="11px" fontWeight={700} noOfLines={1} minW="130px">
                      {task.name || task.id}
                    </Text>
                    <Text
                      bg={statusMeta.bg}
                      border="1px solid"
                      borderColor={statusMeta.borderColor}
                      borderRadius="999px"
                      color={statusMeta.color}
                      fontSize="10px"
                      fontWeight={700}
                      px={2}
                      py="1px"
                    >
                      {statusMeta.label}
                    </Text>
                    <Text color="myGray.500" fontSize="10px">
                      turns {task.turns || 0}
                    </Text>
                    <Text color="myGray.500" fontSize="10px">
                      queue {task.queueLength || 0}
                    </Text>
                    {task.outputFile ? (
                      <Text color="myGray.500" fontSize="10px" maxW="220px" noOfLines={1} title={task.outputFile}>
                        log: {task.outputFile}
                      </Text>
                    ) : null}
                    <Text color="myGray.500" fontSize="10px" ml="auto">
                      {task.isolation || "session"}
                    </Text>
                  </Flex>
                );
              })}
            </Flex>
          ) : null}
        </Box>
      ) : null}

      {Object.values(sessionTasks).some(
        (task) => task.status === "pending" || task.status === "in_progress" || task.status === "blocked"
      ) ? (
        <Box bg="white" border="1px solid" borderColor="myGray.200" borderRadius="10px" mb={3} px={3} py={2}>
          <Flex align="center" justify="space-between" mb={showSessionTasks ? 2 : 0}>
            <Text color="myGray.700" fontSize="12px" fontWeight={700}>
              任务列表 ({Object.keys(sessionTasks).length})
            </Text>
            <Flex align="center" gap={3}>
              {([
                ["all", "全部"],
                ["active", "进行中"],
                ["blocked", "阻塞"],
                ["done", "已结束"],
              ] as Array<["all" | "active" | "done" | "blocked", string]>).map(([value, label]) => (
                <Text
                  key={`session-task-filter-${value}`}
                  as="button"
                  color={sessionTaskFilter === value ? "primary.700" : "myGray.500"}
                  fontSize="11px"
                  fontWeight={sessionTaskFilter === value ? 700 : 500}
                  onClick={() => onSetSessionTaskFilter(value)}
                >
                  {label}
                </Text>
              ))}
              <Text as="button" color="myGray.500" fontSize="11px" onClick={onClearCompletedSessionTasks}>
                清理已完成
              </Text>
              <Text as="button" color="myGray.500" fontSize="11px" onClick={onToggleShowSessionTasks}>
                {showSessionTasks ? "收起" : "展开"}
              </Text>
            </Flex>
          </Flex>
          {showSessionTasks ? (
            <Flex direction="column" gap={1.5}>
              {filteredSessionTaskList.map((task) => {
                const statusMeta = SESSION_TASK_STATUS_META[task.status] || SESSION_TASK_STATUS_META.pending;
                return (
                  <Flex
                    key={task.id}
                    align="center"
                    bg="myGray.50"
                    border="1px solid"
                    borderColor="myGray.150"
                    borderRadius="8px"
                    gap={2}
                    px={2}
                    py={1.5}
                  >
                    <Text color="myGray.700" fontSize="11px" fontWeight={700} noOfLines={1} minW="150px">
                      #{task.id} {task.subject || "Untitled"}
                    </Text>
                    <Text
                      bg={statusMeta.bg}
                      border="1px solid"
                      borderColor={statusMeta.borderColor}
                      borderRadius="999px"
                      color={statusMeta.color}
                      fontSize="10px"
                      fontWeight={700}
                      px={2}
                      py="1px"
                    >
                      {statusMeta.label}
                    </Text>
                    {task.owner ? (
                      <Text color="myGray.500" fontSize="10px" ml="auto">
                        {task.owner}
                      </Text>
                    ) : null}
                  </Flex>
                );
              })}
            </Flex>
          ) : null}
        </Box>
      ) : null}
    </>
  );
};

export default ChatRuntimePanels;
