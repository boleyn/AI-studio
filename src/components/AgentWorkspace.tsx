import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import {
  Box,
  Button,
  Collapse,
  Flex,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Text,
  Tooltip,
  useDisclosure,
  useToast,
  VStack,
} from "@chakra-ui/react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Cpu,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Home,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Server,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import ChatPanel from "@features/chat/components/ChatPanel";
import { useAuth } from "../contexts/AuthContext";

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${url}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed: ${res.status}`);
  }
  return data as T;
}

export type ConversationItem = {
  id: string;
  title: string;
  updatedAt: string;
};

export type ProjectWithConversations = {
  token: string;
  name: string;
  description?: string;
  fileCount?: number;
  createdAt: string;
  updatedAt: string;
  conversations: ConversationItem[];
};

type AgentWorkspaceProps = {
  initialProjectToken?: string;
  initialProjectName?: string;
  initialFiles?: Record<string, { code: string }>;
};

const MAX_COLLAPSED_CONVERSATIONS = 5;

export default function AgentWorkspace({
  initialProjectToken,
  initialFiles = {},
}: AgentWorkspaceProps) {
  const router = useRouter();
  const toast = useToast();
  const { user, logout } = useAuth();

  const [projects, setProjects] = useState<ProjectWithConversations[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [activeToken, setActiveToken] = useState<string>(initialProjectToken || "");
  const [activeChatId, setActiveChatId] = useState<string | undefined>(undefined);
  const [newConvSignal, setNewConvSignal] = useState(0);

  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [showAllConvsByProject, setShowAllConvsByProject] = useState<Record<string, boolean>>({});

  // 工作区文件抽屉（按需展开，默认关闭以保持传统会话体验）
  const [filesDrawerOpen, setFilesDrawerOpen] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<Record<string, { code: string }>>(initialFiles);
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");

  // 沙盒 / 本机连接器模式
  const [sandboxKind, setSandboxKind] = useState<"remote-vm" | "connector">("remote-vm");
  const [connectorUrl, setConnectorUrl] = useState("http://127.0.0.1:8787");
  const [connectorToken, setConnectorToken] = useState("");
  const [testingConnector, setTestingConnector] = useState(false);

  // 新建项目弹窗
  const createModal = useDisclosure();
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      const data = await apiJson<ProjectWithConversations[]>("/projects?includeConversations=1");
      setProjects(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length > 0) {
        setActiveToken((prev) => {
          if (prev && data.some((p) => p.token === prev)) return prev;
          return initialProjectToken && data.some((p) => p.token === initialProjectToken)
            ? initialProjectToken
            : data[0].token;
        });
        setExpandedProjects((prev) => {
          const next = { ...prev };
          const target = initialProjectToken || data[0].token;
          if (target && next[target] === undefined) next[target] = true;
          return next;
        });
      }
    } catch (error) {
      toast({
        title: "加载项目列表失败",
        description: error instanceof Error ? error.message : String(error),
        status: "error",
        duration: 3000,
      });
    } finally {
      setLoadingProjects(false);
    }
  }, [initialProjectToken, toast]);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (initialProjectToken) {
      setActiveToken(initialProjectToken);
      setExpandedProjects((prev) => ({ ...prev, [initialProjectToken]: true }));
    }
  }, [initialProjectToken]);

  useEffect(() => {
    if (!selectedFilePath) {
      const first = Object.keys(workspaceFiles)[0];
      if (first) setSelectedFilePath(first);
    }
  }, [selectedFilePath, workspaceFiles]);

  const activeProject = useMemo(
    () => projects.find((p) => p.token === activeToken) || null,
    [activeToken, projects],
  );

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects
      .map((p) => {
        const projectMatched = p.name.toLowerCase().includes(q);
        const matchedConvs = p.conversations.filter((c) =>
          (c.title || "新对话").toLowerCase().includes(q),
        );
        if (projectMatched) return p;
        if (matchedConvs.length > 0) return { ...p, conversations: matchedConvs };
        return null;
      })
      .filter((p): p is ProjectWithConversations => Boolean(p));
  }, [projects, searchQuery]);

  const toggleProjectExpand = (token: string) => {
    setExpandedProjects((prev) => ({ ...prev, [token]: !prev[token] }));
  };

  const handleSelectProject = (token: string) => {
    setActiveToken(token);
    setActiveChatId(undefined);
    setExpandedProjects((prev) => ({ ...prev, [token]: true }));
  };

  const handleSelectConversation = (token: string, chatId: string) => {
    setActiveToken(token);
    setActiveChatId(chatId);
    setExpandedProjects((prev) => ({ ...prev, [token]: true }));
  };

  const handleNewConversationInProject = (token: string) => {
    setExpandedProjects((prev) => ({ ...prev, [token]: true }));
    if (activeToken !== token) {
      setActiveToken(token);
      setActiveChatId(undefined);
      setTimeout(() => setNewConvSignal((n) => n + 1), 80);
    } else {
      setNewConvSignal((n) => n + 1);
    }
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    setCreatingProject(true);
    try {
      const created = await apiJson<{ token: string; name: string }>("/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setNewProjectName("");
      createModal.onClose();
      await fetchProjects();
      setActiveToken(created.token);
      setActiveChatId(undefined);
      setExpandedProjects((prev) => ({ ...prev, [created.token]: true }));
    } catch (error) {
      toast({
        title: "创建项目失败",
        description: error instanceof Error ? error.message : String(error),
        status: "error",
      });
    } finally {
      setCreatingProject(false);
    }
  };

  const handleDeleteProject = async (token: string, name: string) => {
    try {
      await apiJson(`/projects?token=${encodeURIComponent(token)}`, { method: "DELETE" });
      setProjects((prev) => prev.filter((p) => p.token !== token));
      if (activeToken === token) {
        const remaining = projects.filter((p) => p.token !== token);
        setActiveToken(remaining[0]?.token || "");
        setActiveChatId(undefined);
      }
      toast({ title: `已删除项目「${name}」`, status: "success", duration: 2000 });
    } catch (error) {
      toast({
        title: "删除项目失败",
        description: error instanceof Error ? error.message : String(error),
        status: "error",
      });
    }
  };

  const handleDeleteConversation = async (token: string, chatId: string) => {
    try {
      await apiJson("/core/chat/delHistory", {
        method: "POST",
        body: JSON.stringify({ appId: token, chatId }),
      });
      await fetchProjects();
      if (activeChatId === chatId) setActiveChatId(undefined);
    } catch (error) {
      toast({
        title: "删除会话失败",
        description: error instanceof Error ? error.message : String(error),
        status: "error",
      });
    }
  };

  const handleTestConnector = async () => {
    setTestingConnector(true);
    try {
      const res = await apiJson<{ ok: boolean; rootExists?: boolean; error?: string }>(
        "/agent/connector/test",
        { method: "POST", body: JSON.stringify({ url: connectorUrl, token: connectorToken }) },
      );
      if (res.ok) {
        setSandboxKind("connector");
        toast({ title: "本机连接器连接成功", status: "success", duration: 2500 });
      } else {
        toast({ title: "连接器检查失败", description: res.error, status: "error" });
      }
    } catch (error) {
      toast({
        title: "连接器不可达",
        description: error instanceof Error ? error.message : String(error),
        status: "error",
      });
    } finally {
      setTestingConnector(false);
    }
  };

  const completionsExtraBody = useMemo(
    () =>
      sandboxKind === "connector"
        ? { sandboxKind: "connector", connector: { url: connectorUrl, token: connectorToken } }
        : { sandboxKind: "remote-vm" },
    [connectorToken, connectorUrl, sandboxKind],
  );

  const fileKeys = useMemo(() => Object.keys(workspaceFiles).sort(), [workspaceFiles]);

  return (
    <Flex h="100vh" w="100vw" overflow="hidden" bg="#ffffff" color="#1f2328">
      {/* 最左侧窄导航栏 */}
      <Flex
        w="52px"
        flexShrink={0}
        direction="column"
        align="center"
        justify="space-between"
        py={3}
        bg="#f3f4f6"
        borderRight="1px solid"
        borderColor="#e5e7eb"
      >
        <VStack spacing={3}>
          <Tooltip label="会话工作台" placement="right">
            <IconButton
              aria-label="工作台"
              icon={<Home size={18} />}
              size="sm"
              variant="ghost"
              bg="#e5e7eb"
              color="#111827"
              onClick={() => void router.push("/")}
            />
          </Tooltip>
          <Tooltip label="模型管理" placement="right">
            <IconButton
              aria-label="模型管理"
              icon={<Cpu size={18} />}
              size="sm"
              variant="ghost"
              color="#4b5563"
              onClick={() => void router.push("/models")}
            />
          </Tooltip>
          <Tooltip label="用量统计" placement="right">
            <IconButton
              aria-label="用量统计"
              icon={<Activity size={18} />}
              size="sm"
              variant="ghost"
              color="#4b5563"
              onClick={() => void router.push("/model-usage")}
            />
          </Tooltip>
        </VStack>

        <VStack spacing={2}>
          <Tooltip label={user?.username || "个人中心"} placement="right">
            <IconButton
              aria-label="个人中心"
              icon={<UserIcon size={18} />}
              size="sm"
              variant="ghost"
              color="#4b5563"
              onClick={() => void router.push("/account")}
            />
          </Tooltip>
          <Tooltip label="退出登录" placement="right">
            <IconButton
              aria-label="退出登录"
              icon={<LogOut size={17} />}
              size="sm"
              variant="ghost"
              color="#6b7280"
              onClick={() => void logout()}
            />
          </Tooltip>
        </VStack>
      </Flex>

      {/* 项目文件夹 + 多会话树形侧边栏 */}
      {sidebarOpen ? (
        <Flex
          w="276px"
          flexShrink={0}
          direction="column"
          bg="#f9fafb"
          borderRight="1px solid"
          borderColor="#e5e7eb"
        >
          <Flex px={3.5} pt={3.5} pb={2} align="center" justify="space-between">
            <Text fontWeight="600" fontSize="15px" color="#111827">
              AI Studio
            </Text>
            <HStack spacing={1}>
              <Tooltip label="新建项目文件夹">
                <IconButton
                  aria-label="新建项目"
                  icon={<FolderPlus size={16} />}
                  size="xs"
                  variant="ghost"
                  onClick={createModal.onOpen}
                />
              </Tooltip>
              <Tooltip label="收起侧边栏">
                <IconButton
                  aria-label="收起侧边栏"
                  icon={<PanelLeftClose size={16} />}
                  size="xs"
                  variant="ghost"
                  onClick={() => setSidebarOpen(false)}
                />
              </Tooltip>
            </HStack>
          </Flex>

          <Box px={3} pb={2}>
            <InputGroup size="sm">
              <InputLeftElement pointerEvents="none">
                <Search size={13} color="#9ca3af" />
              </InputLeftElement>
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索项目或会话..."
                bg="#ffffff"
                borderRadius="8px"
                borderColor="#e5e7eb"
                fontSize="13px"
              />
            </InputGroup>
          </Box>

          <Box flex="1" overflowY="auto" px={2} pb={4}>
            {loadingProjects ? (
              <Flex justify="center" py={8}>
                <Spinner size="sm" color="gray.500" />
              </Flex>
            ) : filteredProjects.length === 0 ? (
              <VStack py={10} spacing={3} px={4} textAlign="center">
                <Text fontSize="13px" color="gray.500">
                  暂无项目，创建一个项目来开始多会话对话
                </Text>
                <Button size="sm" leftIcon={<Plus size={14} />} onClick={createModal.onOpen}>
                  新建项目
                </Button>
              </VStack>
            ) : (
              <VStack align="stretch" spacing={1}>
                {filteredProjects.map((project) => {
                  const isExpanded = searchQuery.trim()
                    ? true
                    : Boolean(expandedProjects[project.token]);
                  const isActiveProject = activeToken === project.token;
                  const showAll = Boolean(showAllConvsByProject[project.token]);
                  const visibleConvs = showAll
                    ? project.conversations
                    : project.conversations.slice(0, MAX_COLLAPSED_CONVERSATIONS);
                  const hiddenCount = project.conversations.length - visibleConvs.length;

                  return (
                    <Box key={project.token}>
                      {/* 项目文件夹行 */}
                      <Flex
                        align="center"
                        justify="space-between"
                        px={2}
                        py={1.5}
                        borderRadius="8px"
                        cursor="pointer"
                        bg={isActiveProject && !activeChatId ? "#eceef2" : "transparent"}
                        _hover={{ bg: "#eceef2", "& .proj-actions": { opacity: 1 } }}
                        onClick={() => toggleProjectExpand(project.token)}
                      >
                        <HStack spacing={1.5} minW={0} flex="1">
                          <Box color="gray.500" flexShrink={0}>
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </Box>
                          <Box color="gray.600" flexShrink={0}>
                            {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
                          </Box>
                          <Text
                            fontSize="13px"
                            fontWeight={isActiveProject ? "600" : "500"}
                            color="#1f2937"
                            noOfLines={1}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectProject(project.token);
                            }}
                          >
                            {project.name}
                          </Text>
                        </HStack>

                        <HStack className="proj-actions" spacing={0.5} opacity={0} transition="opacity 0.12s">
                          <Tooltip label="在该项目下新建会话">
                            <IconButton
                              aria-label="新建会话"
                              icon={<Plus size={13} />}
                              size="xs"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleNewConversationInProject(project.token);
                              }}
                            />
                          </Tooltip>
                          <Tooltip label="删除项目">
                            <IconButton
                              aria-label="删除项目"
                              icon={<Trash2 size={13} />}
                              size="xs"
                              variant="ghost"
                              color="gray.500"
                              _hover={{ color: "red.500" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDeleteProject(project.token, project.name);
                              }}
                            />
                          </Tooltip>
                        </HStack>
                      </Flex>

                      {/* 项目下的多会话列表 */}
                      <Collapse in={isExpanded} animateOpacity>
                        <VStack align="stretch" spacing={0.5} pl={6} pr={1} py={0.5}>
                          {visibleConvs.length === 0 ? (
                            <Text
                              fontSize="12px"
                              color="gray.400"
                              px={2}
                              py={1}
                              cursor="pointer"
                              _hover={{ color: "gray.600" }}
                              onClick={() => handleNewConversationInProject(project.token)}
                            >
                              + 点击发起第一个会话
                            </Text>
                          ) : (
                            visibleConvs.map((conv) => {
                              const selected =
                                isActiveProject && activeChatId === conv.id;
                              return (
                                <Flex
                                  key={conv.id}
                                  align="center"
                                  justify="space-between"
                                  px={2.5}
                                  py={1.5}
                                  borderRadius="8px"
                                  cursor="pointer"
                                  bg={selected ? "#ffffff" : "transparent"}
                                  boxShadow={selected ? "0 1px 2px rgba(0,0,0,0.06)" : "none"}
                                  _hover={{
                                    bg: selected ? "#ffffff" : "#eef0f4",
                                    "& .conv-del": { opacity: 1 },
                                  }}
                                  onClick={() => handleSelectConversation(project.token, conv.id)}
                                >
                                  <HStack spacing={2} minW={0} flex="1">
                                    <MessageSquare size={13} color="#6b7280" style={{ flexShrink: 0 }} />
                                    <Text
                                      fontSize="13px"
                                      color={selected ? "#111827" : "#374151"}
                                      fontWeight={selected ? "500" : "400"}
                                      noOfLines={1}
                                    >
                                      {conv.title || "新对话"}
                                    </Text>
                                  </HStack>
                                  <IconButton
                                    className="conv-del"
                                    aria-label="删除会话"
                                    icon={<Trash2 size={12} />}
                                    size="xs"
                                    variant="ghost"
                                    opacity={0}
                                    color="gray.400"
                                    _hover={{ color: "red.500" }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleDeleteConversation(project.token, conv.id);
                                    }}
                                  />
                                </Flex>
                              );
                            })
                          )}
                          {hiddenCount > 0 ? (
                            <Text
                              fontSize="12px"
                              color="gray.500"
                              px={2.5}
                              py={1}
                              cursor="pointer"
                              _hover={{ color: "gray.800" }}
                              onClick={() =>
                                setShowAllConvsByProject((prev) => ({
                                  ...prev,
                                  [project.token]: true,
                                }))
                              }
                            >
                              展开显示 ({hiddenCount})
                            </Text>
                          ) : showAll && project.conversations.length > MAX_COLLAPSED_CONVERSATIONS ? (
                            <Text
                              fontSize="12px"
                              color="gray.500"
                              px={2.5}
                              py={1}
                              cursor="pointer"
                              _hover={{ color: "gray.800" }}
                              onClick={() =>
                                setShowAllConvsByProject((prev) => ({
                                  ...prev,
                                  [project.token]: false,
                                }))
                              }
                            >
                              收起
                            </Text>
                          ) : null}
                        </VStack>
                      </Collapse>
                    </Box>
                  );
                })}
              </VStack>
            )}
          </Box>
        </Flex>
      ) : null}

      {/* 右侧主对话区 */}
      <Flex flex="1" direction="column" minW={0} bg="#ffffff">
        {/* 顶部轻量栏 */}
        <Flex
          h="48px"
          px={4}
          align="center"
          justify="space-between"
          borderBottom="1px solid"
          borderColor="#f0f1f3"
          flexShrink={0}
        >
          <HStack spacing={2}>
            {!sidebarOpen ? (
              <IconButton
                aria-label="展开侧边栏"
                icon={<PanelLeftOpen size={17} />}
                size="sm"
                variant="ghost"
                onClick={() => setSidebarOpen(true)}
              />
            ) : null}
            <Text fontSize="14px" fontWeight="600" color="#111827">
              {activeProject ? activeProject.name : "请选择或创建项目"}
            </Text>
            {activeProject ? (
              <Button
                size="xs"
                variant="ghost"
                leftIcon={<Plus size={13} />}
                onClick={() => handleNewConversationInProject(activeProject.token)}
              >
                新会话
              </Button>
            ) : null}
          </HStack>

          <HStack spacing={2}>
            {/* 沙盒环境选择：虚拟机沙盒 / 本机连接器 */}
            <Menu>
              <MenuButton
                as={Button}
                size="xs"
                variant="outline"
                leftIcon={sandboxKind === "connector" ? <HardDrive size={13} /> : <Server size={13} />}
              >
                {sandboxKind === "connector" ? "本机连接器" : "虚拟机沙盒"}
              </MenuButton>
              <MenuList fontSize="13px">
                <MenuItem onClick={() => setSandboxKind("remote-vm")}>虚拟机沙盒（默认隔离）</MenuItem>
                <MenuItem onClick={() => setSandboxKind("connector")}>本机目录连接器</MenuItem>
              </MenuList>
            </Menu>

            {sandboxKind === "connector" ? (
              <Popover placement="bottom-end">
                <PopoverTrigger>
                  <Button size="xs" variant="ghost" colorScheme="blue">
                    配置连接器
                  </Button>
                </PopoverTrigger>
                <PopoverContent w="300px">
                  <PopoverArrow />
                  <PopoverBody>
                    <VStack align="stretch" spacing={2}>
                      <Text fontSize="12px" fontWeight="600">
                        本机连接器地址
                      </Text>
                      <Input
                        size="xs"
                        value={connectorUrl}
                        onChange={(e) => setConnectorUrl(e.target.value)}
                        placeholder="http://127.0.0.1:8787"
                      />
                      <Input
                        size="xs"
                        type="password"
                        value={connectorToken}
                        onChange={(e) => setConnectorToken(e.target.value)}
                        placeholder="AISTUDIO_CONNECTOR_TOKEN"
                      />
                      <Button
                        size="xs"
                        colorScheme="blue"
                        isLoading={testingConnector}
                        onClick={() => void handleTestConnector()}
                      >
                        测试连通性
                      </Button>
                    </VStack>
                  </PopoverBody>
                </PopoverContent>
              </Popover>
            ) : null}

            <Button
              size="xs"
              variant={filesDrawerOpen ? "solid" : "outline"}
              onClick={() => setFilesDrawerOpen((v) => !v)}
            >
              工作区文件 ({fileKeys.length})
            </Button>
          </HStack>
        </Flex>

        {/* 对话内容区 + 可选右侧文件抽屉 */}
        <Flex flex="1" minH={0} overflow="hidden">
          <Box flex="1" minW={0} h="100%">
            {activeProject ? (
              <ChatPanel
                key={activeProject.token}
                token={activeProject.token}
                hideSkillsManager
                defaultHeaderTitle={activeProject.name}
                completionsExtraBody={completionsExtraBody}
                externalActiveConversationId={activeChatId}
                externalNewConversationSignal={newConvSignal}
                onConversationsChanged={() => void fetchProjects()}
                onFilesUpdated={(files) => {
                  setWorkspaceFiles((prev) => ({ ...prev, ...files }));
                }}
                onOpenWorkspaceFile={(filePath) => {
                  setSelectedFilePath(filePath);
                  setFilesDrawerOpen(true);
                  return true;
                }}
                fileOptions={fileKeys}
                height="100%"
              />
            ) : (
              <Flex h="100%" align="center" justify="center" direction="column" gap={3}>
                <Text color="gray.500" fontSize="14px">
                  创建一个项目文件夹开始与智能体对话
                </Text>
                <Button size="sm" onClick={createModal.onOpen}>
                  新建项目
                </Button>
              </Flex>
            )}
          </Box>

          {/* 按需展开的轻量文件查看抽屉 */}
          {filesDrawerOpen ? (
            <Flex
              w="380px"
              flexShrink={0}
              direction="column"
              borderLeft="1px solid"
              borderColor="#e5e7eb"
              bg="#fafafa"
            >
              <Flex px={3} py={2} borderBottom="1px solid" borderColor="#e5e7eb" justify="space-between" align="center">
                <Text fontSize="13px" fontWeight="600">
                  工作区变更文件
                </Text>
                <Text fontSize="12px" color="gray.500">
                  {fileKeys.length} 个文件
                </Text>
              </Flex>
              <Box maxH="180px" overflowY="auto" borderBottom="1px solid" borderColor="#e5e7eb" p={1.5}>
                {fileKeys.length === 0 ? (
                  <Text fontSize="12px" color="gray.400" p={2}>
                    当前会话暂无项目文件变更
                  </Text>
                ) : (
                  fileKeys.map((p) => (
                    <Text
                      key={p}
                      fontSize="12px"
                      px={2}
                      py={1}
                      borderRadius="6px"
                      cursor="pointer"
                      bg={selectedFilePath === p ? "#e5e7eb" : "transparent"}
                      fontWeight={selectedFilePath === p ? "600" : "400"}
                      noOfLines={1}
                      onClick={() => setSelectedFilePath(p)}
                    >
                      {p}
                    </Text>
                  ))
                )}
              </Box>
              <Box flex="1" overflow="auto" p={3} bg="#ffffff">
                <Box as="pre" fontSize="12px" fontFamily="mono" whiteSpace="pre-wrap" wordBreak="break-word">
                  {selectedFilePath && workspaceFiles[selectedFilePath]
                    ? workspaceFiles[selectedFilePath].code
                    : "// 选择上方文件查看内容"}
                </Box>
              </Box>
            </Flex>
          ) : null}
        </Flex>
      </Flex>

      {/* 新建项目弹窗 */}
      <Modal isOpen={createModal.isOpen} onClose={createModal.onClose} size="sm" isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader fontSize="16px">新建项目文件夹</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="输入项目名称，例如 ai-studio"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateProject();
              }}
              autoFocus
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" size="sm" mr={2} onClick={createModal.onClose}>
              取消
            </Button>
            <Button
              colorScheme="blue"
              size="sm"
              isLoading={creatingProject}
              onClick={() => void handleCreateProject()}
            >
              创建
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Flex>
  );
}
