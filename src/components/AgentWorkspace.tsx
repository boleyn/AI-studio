import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserAccountMenu } from "./UserAccountMenu";
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
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Server,
  Trash2,
} from "lucide-react";
import WorkspaceFilesPanel from "./agent-workspace/WorkspaceFilesPanel";
import { withAuthHeaders } from "@features/auth/client/authClient";
import ChatPanel from "@features/chat/components/ChatPanel";
import { useAuth } from "../contexts/AuthContext";

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${url}`, {
    ...init,
    headers: withAuthHeaders({ "content-type": "application/json", ...(init?.headers || {}) }),
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
  const toast = useToast();
  const { user } = useAuth();

  const [projects, setProjects] = useState<ProjectWithConversations[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => { setSidebarOpen(window.matchMedia("(min-width: 768px)").matches); }, []);
  const closeMobileSidebar = () => {
    if (window.matchMedia("(max-width: 767px)").matches) setSidebarOpen(false);
  };

  const [activeToken, setActiveToken] = useState<string>(initialProjectToken || "");
  const [activeChatId, setActiveChatId] = useState<string | undefined>(undefined);
  const { query } = useRouter();
  const visibleChatId = typeof query.conversation === "string" ? query.conversation : activeChatId;
  const visibleChatIdRef = useRef(visibleChatId);
  visibleChatIdRef.current = visibleChatId;
  const [newConvSignal, setNewConvSignal] = useState(0);

  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [showAllConvsByProject, setShowAllConvsByProject] = useState<Record<string, boolean>>({});

  // 工作区文件抽屉（按需展开，默认关闭以保持传统会话体验）
  const [filesDrawerOpen, setFilesDrawerOpen] = useState(false);
  const [filesByProject, setFilesByProject] = useState<Record<string, Record<string, { code: string }>>>(
    initialProjectToken ? { [initialProjectToken]: initialFiles } : {},
  );
  const workspaceFiles = filesByProject[activeToken] || {};

  useEffect(() => {
    if (!activeToken) return;
    let cancelled = false;
    void apiJson<{ files: Record<string, { code: string }> }>(`/code?token=${encodeURIComponent(activeToken)}`)
      .then(({ files }) => {
        if (!cancelled) setFilesByProject((prev) => ({
          ...prev, [activeToken]: { ...files, ...prev[activeToken] },
        }));
      })
      .catch((error) => {
        if (!cancelled) toast({ title: "加载工作区文件失败", description: String(error), status: "error" });
      });
    return () => { cancelled = true; };
  }, [activeToken, toast]);
  const [artifactVersion, setArtifactVersion] = useState<string>();
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");

  useEffect(() => {
    setSelectedFilePath("");
    setArtifactVersion(undefined);
    setFilesDrawerOpen(false);
  }, [activeToken, activeChatId, newConvSignal]);

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
        const explicitProject = data.find((project) => project.token === initialProjectToken);
        const linkedProject = data.find((project) =>
          project.conversations.some((conversation) => conversation.id === visibleChatIdRef.current),
        );
        const target = (explicitProject ?? linkedProject ?? data[0]).token;
        setActiveToken((prev) => prev && data.some((project) => project.token === prev) ? prev : target);
        setExpandedProjects((prev) => {
          const next = { ...prev };
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
    if (!artifactVersion && (!selectedFilePath || !workspaceFiles[selectedFilePath])) {
      const first = Object.keys(workspaceFiles).find((path) => !/^\/*\.files(?:\/|$)/.test(path));
      if (first) setSelectedFilePath(first);
    }
  }, [selectedFilePath, workspaceFiles, artifactVersion]);

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
    closeMobileSidebar();
    setNewConvSignal(0);
    setActiveToken(token);
    setActiveChatId(undefined);
    setExpandedProjects((prev) => ({ ...prev, [token]: true }));
  };

  const handleSelectConversation = (token: string, chatId: string) => {
    closeMobileSidebar();
    setNewConvSignal(0);
    setActiveToken(token);
    setActiveChatId(chatId);
    setExpandedProjects((prev) => ({ ...prev, [token]: true }));
  };

  const handleNewConversationInProject = (token: string) => {
    closeMobileSidebar();
    setExpandedProjects((prev) => ({ ...prev, [token]: true }));
    setActiveToken(token);
    setActiveChatId(undefined);
    setNewConvSignal((n) => n + 1);
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
      setNewConvSignal(0);
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
        setNewConvSignal(0);
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

  const openWorkspaceFile = useCallback((filePath: string, version?: string) => {
    if (version) {
      setArtifactVersion(version);
      setSelectedFilePath(filePath);
      setFilesDrawerOpen(true);
      return true;
    }
    let decodedPath = filePath;
    try {
      decodedPath = decodeURIComponent(filePath);
    } catch {
      // File paths from tool results can contain a literal percent sign.
    }
    const candidates = [filePath, decodedPath];
    for (const path of [filePath, decodedPath]) {
      const relativePath = path.replace(/^\/+/, "");
      candidates.push(`/${relativePath}`, relativePath);
      if (relativePath.startsWith("mnt/data/")) {
        const name = relativePath.slice("mnt/data/".length);
        candidates.push(`/${name}`, name);
      }
    }
    const match = candidates.find((path) => Object.hasOwn(workspaceFiles, path));
    if (!match) {
      if (filePath.startsWith("/mnt/data/")) {
        toast({ title: "此文件不在当前工作成果中", status: "info" });
      }
      return false;
    }
    setArtifactVersion(undefined);
    setSelectedFilePath(match);
    setFilesDrawerOpen(true);
    return true;
  }, [toast, workspaceFiles]);

  const fileKeys = useMemo(() => Object.keys(workspaceFiles).sort(), [workspaceFiles]);
  const artifactFiles = useMemo(
    () => Object.fromEntries(Object.entries(workspaceFiles).filter(([path]) => !/^\/*\.files(?:\/|$)/.test(path))),
    [workspaceFiles],
  );
  const artifactCount = Object.keys(artifactFiles).length;


  return (
    <Flex h="100dvh" w="100%" overflow="hidden" bg="#ffffff" color="#1f2328">
      {/* 项目文件夹 + 多会话树形侧边栏 */}
      {sidebarOpen ? (
        <Flex
          position={{ base: "absolute", md: "relative" }}
          insetY={0}
          left={0}
          zIndex={3}
          boxShadow={{ base: "xl", md: "none" }}
          w={{ base: "min(280px, 85vw)", md: "260px" }}
          flexShrink={0}
          direction="column"
          bg="#f7f7f7"
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

          <Box px={2} pb={2}>
            {activeProject ? (
              <Button
                size="sm"
                w="full"
                justifyContent="flex-start"
                fontWeight="500"
                variant="ghost"
                leftIcon={<Plus size={13} />}
                onClick={() => handleNewConversationInProject(activeProject.token)}
              >
                新建对话
              </Button>
            ) : null}
          </Box>

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
                  {searchQuery.trim() ? "没有找到匹配的项目或会话" : "创建项目，开始新的工作"}
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
                  const visibleConvs = showAll || searchQuery.trim()
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
                        bg={isActiveProject && !visibleChatId ? "#eceef2" : "transparent"}
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
                                isActiveProject && visibleChatId === conv.id;
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
          <Box px={2} py={2} borderTop="1px solid" borderColor="gray.200">
            <UserAccountMenu user={user} loadingUser={false} showWorkspaceSettings />
          </Box>
        </Flex>
      ) : null}

      {/* 右侧主对话区 */}
      <Flex flex="1" direction="column" minW={0} bg="#ffffff">
        {/* 顶部轻量栏 */}
        <Flex
          minH="56px"
          flexWrap="wrap"
          gap={2}
          py={2}
          px={4}
          align="center"
          justify="space-between"
          borderBottom="1px solid"
          borderColor="transparent"
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
            {activeProject && !sidebarOpen && (
              <IconButton aria-label="新建对话" icon={<Plus size={17} />} size="sm" variant="ghost"
                onClick={() => handleNewConversationInProject(activeProject.token)} />
            )}
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
              工作成果 ({artifactCount})
            </Button>
          </HStack>
        </Flex>

        {/* 对话内容区 + 可选右侧文件抽屉 */}
        <Flex flex="1" minH={0} overflow="hidden" position="relative">
          <Box flex="1" minW={0} h="100%" position="relative" zIndex={0}>
            {activeProject ? (
              <ChatPanel
                key={activeProject.token}
                token={activeProject.token}
                hideHeader
                emptyStateTitle="我们要做什么？"
                hideSkillsManager
                defaultHeaderTitle={activeProject.name}
                completionsExtraBody={completionsExtraBody}
                externalActiveConversationId={activeChatId}
                externalNewConversationSignal={newConvSignal}
                onConversationsChanged={() => void fetchProjects()}
                onFilesUpdated={(files) => {
                  setFilesByProject((prev) => ({ ...prev, [activeProject.token]: { ...prev[activeProject.token], ...files } }));
                }}
                onOpenWorkspaceFile={openWorkspaceFile}
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

          {filesDrawerOpen && (
            <WorkspaceFilesPanel token={activeToken} version={artifactVersion} files={artifactFiles} selectedPath={selectedFilePath}
              onSelect={(path) => { setArtifactVersion(undefined); setSelectedFilePath(path); }} onClose={() => setFilesDrawerOpen(false)} />
          )}
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
