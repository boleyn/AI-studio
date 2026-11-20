import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
  useRef,
} from "react";
import {
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  Grid,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuOptionGroup,
  MenuItemOption,
  Portal,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Select,
  Spinner,
  Text,
  Textarea,
  Tooltip,
  VStack,
  useToast,
} from "@chakra-ui/react";
import {
  ArrowLeft,
  CalendarClock,
  Clock,
  ChevronRight,
  Ellipsis,
  ExternalLink,
  Pause,
  ListFilter,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { DateTime } from "luxon";
import type { Schedule, ScheduleSpec } from "@/shared/schedules/types";
import { withAuthHeaders } from "@features/auth/client/authClient";

import { AppDialog } from "../ui";
import WorkspaceSidebar, {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_ICON_SIZE,
  SidebarActionButton,
  SidebarHeaderIconButton,
  SidebarSectionHeader,
} from "./WorkspaceSidebar";

type Chat = { token: string; id: string; label: string };
type Props = {
  chats: Chat[];
  currentChatId?: string;
  conversation: ReactNode;
  onSelectConversation: (
    task: Pick<
      Schedule,
      "_id" | "token" | "chatId" | "lastResult" | "nextAt" | "state"
    > | null,
  ) => void;
  onOpen: (token: string, chatId: string) => void;
};
const states = {
  paused: "已暂停",
  active: "已启用",
  running: "执行中",
  completed: "已完成",
};
const taskStates = ["running", "active", "paused", "completed"] as const;
const repeats = { once: "单次", daily: "每天", weekdays: "工作日", weekly: "每周", monthly: "每月", hourly: "每小时", yearly: "每年" };

function timing(task: Schedule) {
  if (task.state !== "active") return repeats[task.repeat];

  const next = DateTime.fromMillis(task.nextAt, { zone: task.timezone });
  return `下次运行 ${next.toFormat("M月d日 HH:mm")} · ${repeats[task.repeat]}`;
}

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

export default function SchedulesView({
  chats,
  currentChatId,
  onOpen,
  conversation,
  onSelectConversation,
}: Props) {
  const [tasks, setTasks] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Schedule["state"] | "all">("all");
  const query = search.trim().toLocaleLowerCase();
  const visibleTasks = tasks.filter(
    (task) =>
      (filter === "all" || task.state === filter) &&
      task.title.toLocaleLowerCase().includes(query),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    visibleTasks.find((task) => task._id === selectedId) ?? visibleTasks[0];
  const showMobileDetail = Boolean(selected && selected._id === selectedId);
  const hideDesktopList = sidebarCollapsed && Boolean(selected);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [chatKey, setChatKey] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
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
    } finally {
      setLoading(false);
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
  const selectedTaskId = selected?._id;
  const selectedToken = selected?.token;
  const selectedChatId = selected?.chatId;
  const selectedState = selected?.state;
  const selectedNextAt = selected?.nextAt;
  const selectedResult = selected?.lastResult;
  useEffect(() => {
    onSelectConversation(
      selectedTaskId &&
        selectedToken &&
        selectedChatId &&
        selectedState &&
        selectedNextAt !== undefined
        ? {
            _id: selectedTaskId,
            token: selectedToken,
            chatId: selectedChatId,
            state: selectedState,
            nextAt: selectedNextAt,
            lastResult: selectedResult,
          }
        : null,
    );
  }, [
    onSelectConversation,
    selectedTaskId,
    selectedToken,
    selectedChatId,
    selectedState,
    selectedNextAt,
    selectedResult,
  ]);

  return (
    <Grid
      as="section"
      aria-label="定时任务"
      flex="1"
      minW={0}
      minH={0}
      templateColumns={{
        base: "minmax(0, 1fr)",
        md: hideDesktopList
          ? "minmax(0, 1fr)"
          : `${SIDEBAR_DEFAULT_WIDTH}px minmax(0, 1fr)`,
      }}
      templateRows="minmax(0, 1fr)"
    >
      <WorkspaceSidebar
        w="full"
        display={{
          base: showMobileDetail ? "none" : "flex",
          md: hideDesktopList ? "none" : "flex",
        }}
        borderRightWidth={{ base: 0, md: "1px" }}
        title={
          <Heading as="h1" fontSize="inherit" fontWeight="inherit" lineHeight="inherit">
            定时任务
          </Heading>
        }
        headerActions={
          <>
            <Menu placement="bottom-end" isLazy>
              <MenuButton
                as={SidebarHeaderIconButton}
                aria-label="筛选任务"
                title="筛选任务"
                icon={<ListFilter size={SIDEBAR_ICON_SIZE} />}
                color={filter === "all" ? "ink.secondary" : "ink.primary"}
                bg={filter === "all" ? undefined : "surface.active"}
              />
              <Portal>
                <MenuList minW="136px" fontSize="sm" zIndex="dropdown">
                  <MenuOptionGroup
                    type="radio"
                    value={filter}
                    onChange={(value) => setFilter(value as typeof filter)}
                  >
                    <MenuItemOption value="all">全部状态</MenuItemOption>
                    {taskStates.map((state) => (
                      <MenuItemOption value={state} key={state}>
                        {states[state]}
                      </MenuItemOption>
                    ))}
                  </MenuOptionGroup>
                </MenuList>
              </Portal>
            </Menu>
            <Tooltip label={searchOpen ? "关闭搜索" : "搜索"}>
              <SidebarHeaderIconButton
                aria-label={searchOpen ? "关闭搜索" : "搜索定时任务"}
                aria-expanded={searchOpen}
                icon={<Search size={SIDEBAR_ICON_SIZE} />}
                onClick={() => {
                  setSearchOpen(!searchOpen);
                  if (searchOpen) setSearch("");
                }}
              />
            </Tooltip>
            <Tooltip label="收起侧边栏">
              <SidebarHeaderIconButton
                display={{ base: "none", md: "inline-flex" }}
                aria-label="收起任务列表"
                isDisabled={!selected}
                icon={<PanelLeftClose size={SIDEBAR_ICON_SIZE} />}
                onClick={() => setSidebarCollapsed(true)}
              />
            </Tooltip>
          </>
        }
        search={
          searchOpen ? (
            <InputGroup size="sm">
              <InputLeftElement pointerEvents="none" color="ink.muted">
                <Search size={14} aria-hidden="true" />
              </InputLeftElement>
              <Input
                ref={searchRef}
                type="search"
                aria-label="任务名称"
                placeholder="搜索任务..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                fontSize="13px"
                borderRadius="8px"
              />
            </InputGroup>
          ) : undefined
        }
        primaryAction={
          <SidebarActionButton
            leftIcon={<Plus size={SIDEBAR_ICON_SIZE} />}
            onClick={() => edit()}
            isDisabled={!chats.length || busy}
          >
            新建任务
          </SidebarActionButton>
        }
      >
          {error && (
            <Text role="alert" color="red.700" fontSize="sm" px={2} mb={3}>
              {error}
            </Text>
          )}
          {loading ? (
            <Flex
              role="status"
              align="center"
              gap={2}
              px={2}
              py={4}
              color="ink.secondary"
              fontSize="sm"
            >
              <Spinner size="sm" />
              正在加载任务
            </Flex>
          ) : !tasks.length && !error ? (
            <Text px={2} py={3} color="ink.secondary" fontSize="sm">
              {chats.length
                ? "暂无定时任务"
                : "在项目中开始对话后，即可创建任务。"}
            </Text>
          ) : null}

          {tasks.length > 0 && visibleTasks.length === 0 && (
            <Text
              role="status"
              px={2}
              py={3}
              color="ink.secondary"
              fontSize="sm"
            >
              没有符合条件的任务
            </Text>
          )}
          {taskStates.map((state) => {
            const group = visibleTasks.filter((task) => task.state === state);
            if (!group.length) return null;
            return (
              <Box
                key={state}
                as="section"
                aria-labelledby={`schedule-group-${state}`}
                mb={3}
              >
                <SidebarSectionHeader
                  id={`schedule-group-${state}`}
                  label={states[state]}
                />
                <VStack
                  as="ul"
                  role="list"
                  listStyleType="none"
                  m={0}
                  p={0}
                  spacing={1}
                  align="stretch"
                >
                  {group.map((task) => (
                    <Grid
                      key={task._id}
                      as="li"
                      templateColumns="minmax(0, 1fr) 36px"
                      alignItems="center"
                      borderRadius="lg"
                      bg={
                        selected?._id === task._id
                          ? "surface.active"
                          : undefined
                      }
                      _hover={{
                        bg:
                          selected?._id === task._id
                            ? "surface.active"
                            : "surface.hover",
                      }}
                    >
                      <Box
                        as="button"
                        type="button"
                        textAlign="start"
                        minW={0}
                        borderRadius="lg"
                        px={2}
                        py={2}
                        aria-current={
                          selected?._id === task._id ? true : undefined
                        }
                        _focusVisible={{ boxShadow: "outline" }}
                        onClick={() => setSelectedId(task._id)}
                      >
                        <Text fontSize="sm" fontWeight="600" noOfLines={1}>
                          {task.title}
                        </Text>
                        <Text
                          mt={1}
                          fontSize="xs"
                          color="ink.secondary"
                          overflowWrap="anywhere"
                        >
                          {timing(task)}
                        </Text>
                      </Box>
                      <Menu placement="bottom-end" isLazy>
                        <MenuButton
                          as={IconButton}
                          aria-label={`${task.title}的操作`}
                          icon={<Ellipsis size={18} />}
                          variant="ghost"
                          size="sm"
                          borderRadius="lg"
                          _expanded={{ bg: "surface.active" }}
                        />
                        <Portal>
                          <MenuList
                            minW="160px"
                            fontSize="sm"
                            zIndex="dropdown"
                          >
                            <MenuItem
                              icon={<ExternalLink size={15} />}
                              onClick={() => onOpen(task.token, task.chatId)}
                            >
                              打开会话
                            </MenuItem>
                            <MenuItem
                              icon={<Pencil size={15} />}
                              isDisabled={busy || task.state === "running"}
                              onClick={() => edit(task)}
                            >
                              编辑任务
                            </MenuItem>
                            {(task.state === "active" ||
                              task.state === "paused") && (
                              <MenuItem
                                icon={
                                  task.state === "active" ? (
                                    <Pause size={15} />
                                  ) : (
                                    <Play size={15} />
                                  )
                                }
                                isDisabled={busy}
                                onClick={() =>
                                  void mutate({
                                    action:
                                      task.state === "active"
                                        ? "pause"
                                        : "resume",
                                    id: task._id,
                                  })
                                }
                              >
                                {task.state === "active"
                                  ? "暂停任务"
                                  : "启用任务"}
                              </MenuItem>
                            )}
                            <MenuDivider />
                            <MenuItem
                              icon={<Trash2 size={15} />}
                              color="red.700"
                              isDisabled={busy || task.state === "running"}
                              onClick={() => {
                                if (window.confirm("删除这个定时任务？"))
                                  void mutate({
                                    action: "delete",
                                    id: task._id,
                                  });
                              }}
                            >
                              删除任务
                            </MenuItem>
                          </MenuList>
                        </Portal>
                      </Menu>
                    </Grid>
                  ))}
                </VStack>
              </Box>
            );
          })}
      </WorkspaceSidebar>

      <Flex
        as="article"
        direction="column"
        minW={0}
        minH={0}
        bg="surface.canvas"
        display={{ base: showMobileDetail ? "flex" : "none", md: "flex" }}
      >
        {selected ? (
          <>
            <Flex
              as="header"
              align="center"
              gap={2}
              px={{ base: 2, md: 4 }}
              py={2}
              minH="52px"
              flexShrink={0}
              borderBottomWidth="1px"
              borderColor="stroke.subtle"
            >
              <IconButton
                display={{ md: "none" }}
                variant="ghost"
                size="sm"
                aria-label="返回任务列表"
                icon={<ArrowLeft size={17} />}
                onClick={() => setSelectedId(null)}
              />
              {hideDesktopList && (
                <IconButton
                  display={{ base: "none", md: "inline-flex" }}
                  variant="ghost"
                  size="sm"
                  aria-label="展开任务列表"
                  icon={<PanelLeftOpen size={17} />}
                  onClick={() => setSidebarCollapsed(false)}
                />
              )}
              <Heading
                as="h2"
                size="sm"
                fontWeight="650"
                noOfLines={1}
                flex="1"
                title={selected.title}
              >
                {selected.title}
              </Heading>
              <Popover key={selected._id} placement="bottom-end" isLazy>
                <PopoverTrigger>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    aria-label="任务摘要"
                    icon={<SlidersHorizontal size={17} />}
                    _expanded={{ bg: "surface.active" }}
                  />
                </PopoverTrigger>
                <Portal>
                  <PopoverContent
                    w="min(312px, calc(100vw - 24px))"
                    borderRadius="16px"
                    borderColor="stroke.subtle"
                    shadow="0 6px 20px rgba(0, 0, 0, 0.07)"
                    zIndex="popover"
                    aria-label="任务摘要"
                  >
                    <PopoverBody px={5} py={4}>
                      <Text fontSize="sm" color="ink.secondary" mb={2}>
                        定时任务
                      </Text>
                      <Flex
                        as="button"
                        type="button"
                        w="full"
                        textAlign="start"
                        align="center"
                        gap={2.5}
                        py={2}
                        px={1}
                        borderRadius="md"
                        _hover={{ bg: "surface.hover" }}
                        _focusVisible={{ boxShadow: "outline" }}
                        _disabled={{ opacity: 0.6, cursor: "not-allowed" }}
                        disabled={busy || selected.state === "running"}
                        onClick={() => edit(selected)}
                        aria-label={`编辑调度：${selected.title}`}
                      >
                        <Box flexShrink={0} aria-hidden="true">
                          <Clock size={16} />
                        </Box>
                        <Text noOfLines={1} flex="1" fontSize="sm">
                          {selected.title}
                        </Text>
                        <Text
                          flexShrink={0}
                          color="ink.secondary"
                          fontSize="xs"
                        >
                          {states[selected.state]}
                        </Text>
                        <Box
                          flexShrink={0}
                          color="ink.secondary"
                          aria-hidden="true"
                        >
                          <ChevronRight size={13} />
                        </Box>
                      </Flex>
                      <Box
                        mt={3}
                        pt={3}
                        borderTopWidth="1px"
                        borderColor="stroke.subtle"
                        fontSize="sm"
                      >
                        <Text color="ink.secondary" mb={2}>
                          最近运行
                        </Text>
                        <Text color="ink.secondary" fontSize="xs">
                          {selected.lastResult || "暂无运行结果"}
                        </Text>
                      </Box>
                    </PopoverBody>
                  </PopoverContent>
                </Portal>
              </Popover>
            </Flex>
            {conversation ?? (
              <Text role="status" p={4} fontSize="sm" color="ink.secondary">
                正在打开任务会话
              </Text>
            )}
          </>
        ) : !loading && !error ? (
          <VStack justify="center" flex="1" spacing={3} color="ink.secondary">
            <CalendarClock size={28} strokeWidth={1.5} aria-hidden="true" />
            <Text fontSize="sm">
              {tasks.length
                ? "没有符合条件的任务"
                : "创建任务后，可在这里查看会话和运行结果。"}
            </Text>
          </VStack>
        ) : null}
      </Flex>

      <AppDialog
        isOpen={Boolean(editing)}
        onClose={() => {
          if (!busy) setEditing(null);
        }}
        title={editing === "new" ? "新建任务" : "编辑任务"}
        initialFocusRef={titleRef}
        onSubmit={save}
        footer={
          <Flex gap={2} justify="flex-end">
            <Button
              size="sm"
              variant="ghost"
              borderRadius="lg"
              onClick={() => setEditing(null)}
              isDisabled={busy}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              borderRadius="lg"
              type="submit"
              isLoading={busy}
            >
              {editing === "new" ? "创建任务" : "保存修改"}
            </Button>
          </Flex>
        }
      >
        <VStack
          align="stretch"
          spacing={4}
          sx={{ label: { fontSize: "sm", marginBottom: 1.5 } }}
        >
          <FormControl isRequired>
            <FormLabel>任务名称</FormLabel>
            <Input
              ref={titleRef}
              required
              maxLength={100}
              value={title}
              placeholder="例如：每周项目简报"
              onChange={(e) => setTitle(e.target.value)}
            />
          </FormControl>
          <FormControl isRequired>
            <FormLabel>执行指令</FormLabel>
            <Textarea
              required
              maxLength={4000}
              value={prompt}
              rows={3}
              resize="vertical"
              placeholder="描述任务运行时要做的事"
              onChange={(e) => setPrompt(e.target.value)}
            />
          </FormControl>
          <Box borderTopWidth="1px" borderColor="stroke.subtle" pt={4}>
            <Grid
              templateColumns={{
                base: "minmax(0, 1fr)",
                sm: "minmax(0, 2fr) minmax(0, 1fr)",
              }}
              gap={3}
            >
              <FormControl isRequired>
                <FormLabel>首次执行时间</FormLabel>
                <Input
                  type="datetime-local"
                  size="sm"
                  borderRadius="md"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </FormControl>
              <FormControl>
                <FormLabel>重复</FormLabel>
                <Select
                  size="sm"
                  borderRadius="md"
                  value={repeat}
                  onChange={(e) =>
                    setRepeat(e.target.value as ScheduleSpec["repeat"])
                  }
                >
                  {Object.entries(repeats).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <FormControl isRequired mt={3}>
              <FormLabel>时区</FormLabel>
              <Input
                size="sm"
                borderRadius="md"
                required
                value={zone}
                onChange={(e) => setZone(e.target.value)}
              />
            </FormControl>
          </Box>
          {editing === "new" && (
            <FormControl isRequired>
              <FormLabel>来源会话</FormLabel>
              <Select
                required
                size="sm"
                borderRadius="md"
                value={chatKey}
                onChange={(e) => setChatKey(e.target.value)}
              >
                {chats.map((chat) => {
                  const value = JSON.stringify([chat.token, chat.id]);
                  return (
                    <option key={value} value={value}>
                      {chat.label}
                    </option>
                  );
                })}
              </Select>
            </FormControl>
          )}
        </VStack>
      </AppDialog>
    </Grid>
  );
}
