import { Box, Button, Flex, Heading, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import type { Schedule } from "@/shared/schedules/types";
import { withAuthHeaders } from "@features/auth/client/authClient";

const labels = { active: "已启用", running: "执行中", paused: "已暂停", completed: "已完成" };

export default function SiteSchedules({ siteId }: { siteId: string }) {
  const [tasks, setTasks] = useState<Schedule[]>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setTasks(undefined);
    async function load() {
      try {
        const response = await fetch("/api/schedules?" + new URLSearchParams({ siteId }), {
          headers: withAuthHeaders(), signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Array.isArray(data.tasks)) throw new Error();
        if (!controller.signal.aborted) setTasks(data.tasks);
      } catch {
        if (!controller.signal.aborted) setError("无法加载已安排的任务，请稍后重试。");
      }
    }
    void load();
    return () => controller.abort();
  }, [siteId, attempt]);
  return <Box as="section" mt={6}>
    <Heading as="h2" size="sm">已安排的任务</Heading>
    <Text mt={1} mb={4} fontSize="sm" color="gray.600">按设定的任务时间自动更新你的站点</Text>
    {error ? <Flex align="center" gap={2}><Text role="alert">{error}</Text><Button size="sm" onClick={() => setAttempt(n => n + 1)}>重试</Button></Flex>
      : !tasks ? <Text role="status">正在加载已安排的任务…</Text>
      : !tasks.length ? <Text role="status">暂无已安排的任务</Text>
      : <Box as="ul" listStyleType="none">{tasks.map(task => <Box as="li" key={task._id} py={3} borderBottomWidth="1px">
        <Flex align="baseline" justify="space-between" gap={3}><Text overflowWrap="anywhere">{task.title}</Text><Text flexShrink={0} fontSize="sm">{labels[task.state]}</Text></Flex>
        {task.state === "active" && <Text fontSize="sm" color="gray.600">下次运行 {new Date(task.nextAt).toLocaleString("zh-CN", { timeZone: task.timezone, timeZoneName: "short" })}</Text>}
      </Box>)}</Box>}
  </Box>;
}
