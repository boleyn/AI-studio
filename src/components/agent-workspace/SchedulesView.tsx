import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  Input,
  Select,
  Text,
  Textarea,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { DateTime } from "luxon";
import type { Schedule, ScheduleSpec } from "@/shared/schedules/types";
import { withAuthHeaders } from "@features/auth/client/authClient";

type Chat = { token: string; id: string; label: string };
type Props = {
  chats: Chat[];
  currentChatId?: string;
  onOpen: (token: string, chatId: string) => void;
};
const states = {
  paused: "已暂停",
  active: "已启用",
  running: "执行中",
  completed: "已完成",
};
const repeats = { once: "单次", daily: "每天", weekly: "每周" };

async function request(body?: object) {
  const response = await fetch("/api/schedules", {
    method: body ? "POST" : "GET",
    headers: withAuthHeaders({ "Content-Type": "application/json" }),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "定时任务请求失败");
  return data;
}

export default function SchedulesView({ chats, currentChatId, onOpen }: Props) {
  const [tasks, setTasks] = useState<Schedule[]>([]);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [chatKey, setChatKey] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [time, setTime] = useState("");
  const [zone, setZone] = useState("");
  const [repeat, setRepeat] = useState<ScheduleSpec["repeat"]>("once");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const reload = useCallback(async () => {
    try {
      setTasks((await request()).tasks);
      setError("");
    } catch (err) {
      setError(String(err));
    }
  }, []);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 10000);
    return () => clearInterval(timer);
  }, [reload]);
  function edit(task?: Schedule) {
    const chat = task || chats.find((c) => c.id === currentChatId) || chats[0];
    setChatKey(
      chat
        ? JSON.stringify([chat.token, "chatId" in chat ? chat.chatId : chat.id])
        : "",
    );
    setTitle(task?.title || "");
    setPrompt(task?.prompt || "");
    const timezone =
      task?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    setZone(timezone);
    setTime(
      (task
        ? DateTime.fromISO(task.firstAt)
        : DateTime.now().plus({ hours: 1 })
      )
        .setZone(timezone)
        .toFormat("yyyy-MM-dd'T'HH:mm"),
    );
    setRepeat(task?.repeat || "once");
    setEditing(task || "new");
  }
  async function mutate(body: object) {
    setBusy(true);
    try {
      await request(body);
      setEditing(null);
      await reload();
    } catch (err) {
      toast({ title: String(err), status: "error" });
    } finally {
      setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const date = DateTime.fromISO(time, { zone });
    if (!date.isValid || date.toFormat("yyyy-MM-dd'T'HH:mm") !== time) {
      toast({ title: "该时区或当地时间无效", status: "error" });
      return;
    }
    const spec = {
      title,
      prompt,
      timezone: zone,
      firstAt: date.toISO(),
      repeat,
    };
    if (editing && editing !== "new")
      void mutate({ action: "edit", id: editing._id, spec });
    else {
      const [token, chatId] = JSON.parse(chatKey);
      void mutate({ action: "create", token, chatId, spec });
    }
  }
  return (
    <Box flex="1" overflowY="auto" p={{ base: 4, md: 8 }}>
      <VStack maxW="760px" mx="auto" align="stretch" spacing={4}>
        <Flex align="center" justify="space-between">
          <Heading size="md">定时任务</Heading>
          <Button size="sm" onClick={() => edit()} isDisabled={!chats.length}>
            新建任务
          </Button>
        </Flex>
        {error && <Text role="alert">{error}</Text>}
        {editing && (
          <Box as="form" onSubmit={save} borderWidth="1px" rounded="lg" p={4}>
            <VStack align="stretch">
              <FormControl isRequired>
                <FormLabel>来源会话</FormLabel>
                <Select
                  required
                  value={chatKey}
                  isDisabled={editing !== "new"}
                  onChange={(e) => setChatKey(e.target.value)}
                >
                  {chats.map((c) => (
                    <option
                      key={JSON.stringify([c.token, c.id])}
                      value={JSON.stringify([c.token, c.id])}
                    >
                      {c.label}
                    </option>
                  ))}
                </Select>
              </FormControl>
              <FormControl isRequired>
                <FormLabel>任务名称</FormLabel>
                <Input
                  required
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>执行指令</FormLabel>
                <Textarea
                  required
                  maxLength={4000}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>首次执行时间</FormLabel>
                <Input
                  type="datetime-local"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>时区</FormLabel>
                <Input
                  required
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                />
              </FormControl>
              <FormControl>
                <FormLabel>重复</FormLabel>
                <Select
                  value={repeat}
                  onChange={(e) =>
                    setRepeat(e.target.value as ScheduleSpec["repeat"])
                  }
                >
                  {Object.entries(repeats).map(([v, label]) => (
                    <option value={v} key={v}>
                      {label}
                    </option>
                  ))}
                </Select>
              </FormControl>
              <Flex gap={2}>
                <Button type="submit" isLoading={busy}>
                  保存
                </Button>
                <Button onClick={() => setEditing(null)}>取消</Button>
              </Flex>
            </VStack>
          </Box>
        )}
        {!tasks.length && !error && (
          <Text color="ink.muted">
            {chats.length
              ? "暂无定时任务"
              : "先在项目里开始一段对话，即可为它设置定时任务。"}
          </Text>
        )}
        {tasks.map((task) => (
          <Box key={task._id} p={4} borderWidth="1px" rounded="lg">
            <Heading size="sm">{task.title}</Heading>
            <Text my={2} whiteSpace="pre-wrap">
              {task.prompt}
            </Text>
            <Text fontSize="sm">
              {states[task.state]} · {repeats[task.repeat]} ·{" "}
              {DateTime.fromMillis(task.nextAt, {
                zone: task.timezone,
              }).toFormat("yyyy-MM-dd HH:mm")}{" "}
              ({task.timezone})
            </Text>
            {task.lastResult && <Text fontSize="sm">{task.lastResult}</Text>}
            <Flex gap={2} mt={3} wrap="wrap">
              <Button size="sm" onClick={() => onOpen(task.token, task.chatId)}>
                打开会话
              </Button>
              <Button
                size="sm"
                isDisabled={busy || task.state === "running"}
                onClick={() => edit(task)}
              >
                编辑
              </Button>
              {["active", "paused"].includes(task.state) && (
                <Button
                  size="sm"
                  isDisabled={busy}
                  onClick={() =>
                    void mutate({
                      action: task.state === "active" ? "pause" : "resume",
                      id: task._id,
                    })
                  }
                >
                  {task.state === "active" ? "暂停" : "启用"}
                </Button>
              )}
              <Button
                size="sm"
                isDisabled={busy || task.state === "running"}
                onClick={() => {
                  if (window.confirm("删除这个定时任务？"))
                    void mutate({ action: "delete", id: task._id });
                }}
              >
                删除
              </Button>
            </Flex>
          </Box>
        ))}
      </VStack>
    </Box>
  );
}
