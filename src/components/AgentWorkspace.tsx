import { deviceDisplayName } from "@/shared/localDevice/displayName";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserAccountMenu } from "./UserAccountMenu";
import {
  Box,
  Button,
  Collapse,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  Spinner,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Portal,
  Text,
  Textarea,
  Tooltip,
  useDisclosure,
  useToast,
  VStack,
} from "@chakra-ui/react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Home,
  LayoutGrid,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  SquarePen,
  Trash2,
} from "lucide-react";
import { AppDialog } from "./ui";
import WorkspaceFilesPanel from "./agent-workspace/WorkspaceFilesPanel";
import WorkspaceRuntimeModal, {
  DEFAULT_RUNTIME_CONFIG,
  loadProjectRuntimeConfig,
  saveProjectRuntimeConfig,
  type ProjectRuntimeConfig,
} from "./agent-workspace/WorkspaceRuntimeModal";
import ProjectSettingsModal from "./agent-workspace/ProjectSettingsModal";
import ProjectsDirectoryView from "./agent-workspace/ProjectsDirectoryView";
import type { Schedule } from "@/shared/schedules/types";
import SchedulesView from "./agent-workspace/SchedulesView";
import FloatingResourcesCard from "./agent-workspace/FloatingResourcesCard";
import { withAuthHeaders } from "@features/auth/client/authClient";
import ChatPanel, { type ConversationResources } from "@features/chat/components/ChatPanel";
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
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

  // 右侧浮动资源卡（输出 / 来源）与文件预览抽屉
  const [floatingResourcesOpen, setFloatingResourcesOpen] = useState(false);
  const [conversationResources, setConversationResources] = useState<ConversationResources>();
  const [filesDrawerOpen, setFilesDrawerOpen] = useState(false);
  const [filesByProject, setFilesByProject] = useState<Record<string, Record<string, { code: string }>>>(
    initialProjectToken ? { [initialProjectToken]: initialFiles } : {},
  );
  const workspaceFiles = filesByProject[activeToken] || {};

  useEffect(() => {
    if (!activeToken) return;
    let cancelled = false;
    void apiJson<{ files: Record<string, { code: string }> }>(`/code?${new URLSearchParams({ token: activeToken, action: "outputs" })}`)
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
  const [artifactRevision, setArtifactRevision] = useState<{ text: string; onApplied: () => void }>();
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");

  useEffect(() => {
    setSelectedFilePath("");
    setArtifactVersion(undefined);
    setFilesDrawerOpen(false);
  }, [activeToken, activeChatId, newConvSignal]);

  // 项目级执行环境配置（按项目 token 持久化，切换项目自动恢复）
  const [runtimeByProject, setRuntimeByProject] = useState<Record<string, ProjectRuntimeConfig>>({});
  const runtimeModal = useDisclosure();
  const [composerPanel, setComposerPanel] = useState(false);
  const [runtimeTargetProject, setRuntimeTargetProject] = useState<{ token: string; name: string } | null>(null);

  const activeRuntime = useMemo(
    () => (activeToken ? runtimeByProject[activeToken] || loadProjectRuntimeConfig(activeToken) : DEFAULT_RUNTIME_CONFIG),
    [activeToken, runtimeByProject],
  );

  useEffect(() => {
    if (!activeToken) return;
    setRuntimeByProject((prev) => (prev[activeToken] ? prev : { ...prev, [activeToken]: loadProjectRuntimeConfig(activeToken) }));
  }, [activeToken]);

  // 项目设置与删除确认弹窗
  const settingsModal = useDisclosure();
  const [editingProject, setEditingProject] = useState<ProjectWithConversations | null>(null);
  const deleteConfirmModal = useDisclosure();
  const [pendingDeleteProject, setPendingDeleteProject] = useState<{ token: string; name: string } | null>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const [activeNav, setActiveNav] = useState<"chat" | "schedules" | "projects">("chat");
  const [scheduleConversation, setScheduleConversation] = useState<Pick<Schedule, "_id" | "token" | "chatId" | "lastResult" | "nextAt" | "state"> | null>(null);
  const selectScheduleConversation = useCallback((task: typeof scheduleConversation) => {
    setScheduleConversation(task);
    if (!task) return;
    setNewConvSignal(0);
    setActiveToken(task.token);
    setActiveChatId(task.chatId);
  }, []);
  const [pinnedProjectTokens, setPinnedProjectTokens] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("aistudio:pinned-projects");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const togglePinProject = (token: string) => {
    setPinnedProjectTokens((prev) => {
      const next = prev.includes(token) ? prev.filter((t) => t !== token) : [token, ...prev];
      try {
        window.localStorage.setItem("aistudio:pinned-projects", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // 新建项目弹窗
  const createModal = useDisclosure();
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const newProjectNameRef = useRef<HTMLInputElement>(null);

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

  const [pairedDevices, setPairedDevices] = useState<
    Array<{ deviceId: string; name: string; platform?: string; online: boolean }>
  >([]);
  const [cloudHostStatus, setCloudHostStatus] = useState<
    "allocating" | "ready" | "sleeping" | "stopped"
  >("ready");

  const fetchCloudHostStatus = useCallback(async () => {
    try {
      const data = await apiJson<{
        host?: { status?: "allocating" | "ready" | "sleeping" | "stopped" };
      }>("/core/sandbox/hostStatus");
      if (data?.host?.status) {
        setCloudHostStatus(data.host.status);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchPairedDevices = useCallback(async () => {
    try {
      const data = await apiJson<{
        devices?: Array<{ deviceId?: string; name?: string; remark?: string; platform?: string; online?: boolean }>;
      }>("/core/localDevice/manage");
      const list = Array.isArray(data?.devices)
        ? data.devices
            .filter((d) => typeof d?.deviceId === "string" && d.deviceId.trim())
            .map((d) => ({
              deviceId: String(d.deviceId),
              name: deviceDisplayName(d),
              platform: d.platform,
              online: Boolean(d.online),
            }))
        : [];
      setPairedDevices(list);
    } catch {
      // ignore if user has no devices or endpoint unavailable
    }
  }, []);

  useEffect(() => {
    void fetchProjects();
    void fetchPairedDevices();
    void fetchCloudHostStatus();
  }, [fetchProjects, fetchPairedDevices, fetchCloudHostStatus]);

  useEffect(() => {
    if (initialProjectToken) {
      setActiveToken(initialProjectToken);
      setExpandedProjects((prev) => ({ ...prev, [initialProjectToken]: true }));
    }
  }, [initialProjectToken]);


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
        body: JSON.stringify({
          name,
          files: {},
          dependencies: {},
          ...(newProjectDesc.trim() ? { description: newProjectDesc.trim() } : {}),
        }),
      });
      setNewProjectName("");
      setNewProjectDesc("");
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

  const handleSaveProjectSettings = async (
    token: string,
    updates: { name: string; description: string },
  ) => {
    try {
      await apiJson("/projects", {
        method: "PATCH",
        body: JSON.stringify({ token, name: updates.name, description: updates.description }),
      });
      setProjects((prev) =>
        prev.map((p) =>
          p.token === token ? { ...p, name: updates.name, description: updates.description } : p,
        ),
      );
      toast({ title: "项目设置已保存", status: "success", duration: 2000 });
    } catch (error) {
      toast({
        title: "保存项目设置失败",
        description: error instanceof Error ? error.message : String(error),
        status: "error",
      });
      throw error;
    }
  };

  const handleSaveRuntimeConfig = (projectToken: string, next: ProjectRuntimeConfig) => {
    saveProjectRuntimeConfig(projectToken, next);
    setRuntimeByProject((prev) => ({ ...prev, [projectToken]: next }));
    toast({
      title: next.sandboxKind === "connector" ? "已切换为本地电脑" : "已切换为云电脑",
      status: "success",
      duration: 2000,
    });
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

  const handleTestConnector = async (url: string, token: string) => {
    const start = Date.now();
    try {
      const res = await apiJson<{ ok: boolean; error?: string }>("/agent/connector/test", {
        method: "POST",
        body: JSON.stringify({ url, token }),
      });
      return { ok: Boolean(res.ok), latencyMs: Date.now() - start, error: res.error };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const completionsExtraBody = useMemo(
    () =>
      activeRuntime.sandboxKind === "connector"
        ? activeRuntime.deviceId && activeRuntime.grantId
          ? {
              sandboxKind: "connector",
              connector: {
                deviceId: activeRuntime.deviceId,
                grantId: activeRuntime.grantId,
              },
            }
          : {
              sandboxKind: "connector",
              connector: { url: activeRuntime.connectorUrl, token: activeRuntime.connectorToken },
            }
        : { sandboxKind: "remote-vm" },
    [
      activeRuntime.connectorToken,
      activeRuntime.connectorUrl,
      activeRuntime.deviceId,
      activeRuntime.grantId,
      activeRuntime.sandboxKind,
    ],
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
    () => Object.fromEntries(Object.entries(workspaceFiles).filter(([path]) => !/^\/*(?:\.files|\.aistudio)(?:\/|$)/.test(path))),
    [workspaceFiles],
  );
  const artifactCount = Object.keys(artifactFiles).length;
  const currentResources = conversationResources?.token === activeToken &&
    conversationResources.conversationId === visibleChatId ? conversationResources : undefined;

  const recentConversations = useMemo(() => {
    const items: Array<ConversationItem & { projectToken: string; projectName: string }> = [];
    for (const project of projects) {
      for (const conv of project.conversations) {
        items.push({
          ...conv,
          projectToken: project.token,
          projectName: project.name,
        });
      }
    }
    return items
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
      .slice(0, 8);
  }, [projects]);

  const conversationPane = (
      <Flex flex="1" direction="column" minW={0} bg="#ffffff">
        {activeNav !== "schedules" && (
        <Flex
          minH="52px"
          flexWrap="wrap"
          gap={2}
          py={2}
          px={4}
          align="center"
          justify="space-between"
          flexShrink={0}
        >
          <HStack spacing={2} minW={0}>
            {!sidebarOpen ? (
              <IconButton
                aria-label="展开侧边栏"
                icon={<PanelLeftOpen size={17} />}
                size="sm"
                variant="ghost"
                onClick={() => setSidebarOpen(true)}
              />
            ) : null}
            {activeProject ? (
              <Menu placement="bottom-start" isLazy>
                <MenuButton
                  as={Button}
                  size="sm"
                  variant="ghost"
                  px={2}
                  fontWeight="600"
                  fontSize="14px"
                  color="ink.primary"
                  leftIcon={
                    activeRuntime.sandboxKind === "connector" ? (
                      <HardDrive size={15} />
                    ) : (
                      <Folder size={15} />
                    )
                  }
                  rightIcon={<ChevronDown size={14} color="#8f8f8f" />}
                >
                  <Text noOfLines={1} maxW={{ base: "140px", md: "240px" }}>
                    {activeProject.name}
                  </Text>
                </MenuButton>
                <MenuList minW="220px">
                  {projects.map((p) => (
                    <MenuItem
                      key={p.token}
                      fontWeight={p.token === activeProject.token ? "600" : "400"}
                      bg={p.token === activeProject.token ? "surface.hover" : "transparent"}
                      icon={<Folder size={14} />}
                      onClick={() => handleSelectProject(p.token)}
                    >
                      <Text noOfLines={1}>{p.name}</Text>
                    </MenuItem>
                  ))}
                  <MenuDivider />
                  <MenuItem
                    icon={<Pencil size={14} />}
                    onClick={() => {
                      setEditingProject(activeProject);
                      settingsModal.onOpen();
                    }}
                  >
                    项目设置与说明
                  </MenuItem>
                  <MenuItem icon={<FolderPlus size={14} />} onClick={createModal.onOpen}>
                    新建项目
                  </MenuItem>
                </MenuList>
              </Menu>
            ) : (
              <Text fontSize="14px" fontWeight="600" color="ink.primary">
                请选择或创建项目
              </Text>
            )}
            {activeProject && !sidebarOpen && (
              <Tooltip label="新建对话">
                <IconButton
                  aria-label="新建对话"
                  icon={<SquarePen size={16} />}
                  size="sm"
                  variant="ghost"
                  onClick={() => handleNewConversationInProject(activeProject.token)}
                />
              </Tooltip>
            )}
          </HStack>

          {activeProject && (
            <Popover placement="bottom-end" isLazy isOpen={floatingResourcesOpen && !filesDrawerOpen}
              onOpen={() => {
                setFilesDrawerOpen(false);
                setSelectedFilePath("");
                setFloatingResourcesOpen(true);
              }}
              onClose={() => setFloatingResourcesOpen(false)}
            >
              <PopoverTrigger>
                <IconButton aria-label="会话资源" title={`会话资源 (${artifactCount} 项输出)`}
                  icon={<SlidersHorizontal size={17} />} size="sm" variant="ghost" borderRadius="lg"
                  bg={floatingResourcesOpen || filesDrawerOpen ? "surface.active" : "transparent"}
                />
              </PopoverTrigger>
              <Portal>
                <PopoverContent aria-label="会话资源" w="min(284px, calc(100vw - 24px))" borderRadius="16px"
                  borderColor="stroke.subtle" shadow="0 6px 20px rgba(0,0,0,0.07)" zIndex="popover"
                >
                  <PopoverBody p={0}>
                    <FloatingResourcesCard
                      token={activeProject.token}
                      conversationId={visibleChatId}
                      files={artifactFiles}
                      resources={currentResources}
                      onSelectFile={(path) => {
                        setFloatingResourcesOpen(false);
                        setArtifactVersion(undefined);
                        setSelectedFilePath(path);
                        setFilesDrawerOpen(true);
                      }}
                    />
                  </PopoverBody>
                </PopoverContent>
              </Portal>
            </Popover>
          )}
        </Flex>

        )}

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
                externalConversationRevision={activeNav === "schedules" && scheduleConversation
                  ? `${scheduleConversation.nextAt}:${scheduleConversation.state}:${scheduleConversation.lastResult ?? ""}`
                  : undefined}
                externalNewConversationSignal={newConvSignal}
                onConversationsChanged={() => void fetchProjects()}
                onConversationResourcesChanged={setConversationResources}
                onFilesUpdated={(files) => {
                  setFilesByProject((prev) => ({ ...prev, [activeProject.token]: { ...prev[activeProject.token], ...files } }));
                }}
                artifactRevision={artifactRevision}
                onOpenWorkspaceFile={openWorkspaceFile}
                fileOptions={fileKeys}
                height="100%"
                workspaceComposer={{
                  runtimeKind: activeRuntime.sandboxKind,
                  runtimeLabel:
                    activeRuntime.sandboxKind === "connector"
                      ? pairedDevices.find(d => d.deviceId === activeRuntime.deviceId)?.name || deviceDisplayName({ name: activeRuntime.deviceName })
                      : "云电脑",
                  runtimeDeviceId: activeRuntime.deviceId,
                  cloudHostStatus,
                  devices: pairedDevices,
                  onOpenHostMenu: () => void fetchPairedDevices(),
                  onSelectCloudHost: () => {
                    handleSaveRuntimeConfig(activeProject.token, {
                      ...activeRuntime,
                      sandboxKind: "remote-vm",
                    });
                  },
                  platformPanel: composerPanel && <WorkspaceRuntimeModal embedded isOpen
                    projectName={activeProject.name} projectToken={activeProject.token} config={activeRuntime}
                    onClose={() => { setComposerPanel(false); void fetchPairedDevices(); }}
                    onSave={next => handleSaveRuntimeConfig(activeProject.token, next)}
                    onTestConnector={handleTestConnector} cloudHostStatus={cloudHostStatus} />,
                  closePlatformPanel: () => { setComposerPanel(false); void fetchPairedDevices(); },
                  onSelectDeviceHost: (device) => {
                    void (async () => {
                      if (activeRuntime.deviceId === device.deviceId && activeRuntime.grantId) {
                        handleSaveRuntimeConfig(activeProject.token, {
                          ...activeRuntime,
                          sandboxKind: "connector",
                          deviceId: device.deviceId,
                          deviceName: device.name,
                        });
                        return;
                      }
                      try {
                        const { grant } = await apiJson<{ grant: { grantId: string; workdir: string } }>(
                          "/core/localDevice/grant", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "request", appId: activeProject.token, deviceId: device.deviceId }),
                          },
                        );
                        handleSaveRuntimeConfig(activeProject.token, {
                          ...activeRuntime, sandboxKind: "connector", deviceId: device.deviceId,
                          deviceName: device.name, grantId: grant.grantId, workdir: grant.workdir,
                        });
                        return;
                      } catch {
                        toast({ title: "无法使用这台电脑，请检查连接器中的账号授权", status: "warning" });
                      }
                      setComposerPanel(true);
                    })();
                  },
                  onOpenRuntime: () => {
                    setComposerPanel(true);
                  },
                  projectToken: activeProject.token,
                  projectName: activeProject.name,
                  projects: projects.map((p) => ({ token: p.token, name: p.name })),
                  onSelectProject: handleSelectProject,
                  onCreateProject: createModal.onOpen,
                }}
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
            <WorkspaceFilesPanel key={visibleChatId || activeToken} token={activeToken} conversationId={visibleChatId} onSelectVersion={setArtifactVersion} version={artifactVersion} files={artifactFiles} selectedPath={selectedFilePath}
              onRequestRevision={(text) => { setArtifactRevision({ text, onApplied: () => setArtifactRevision(undefined) }); setFilesDrawerOpen(false); }}
              sources={currentResources?.files ?? []}
              onShowList={() => { setArtifactVersion(undefined); setSelectedFilePath(""); }}
              onSelect={(path) => { setArtifactVersion(undefined); setSelectedFilePath(path); }} onClose={() => setFilesDrawerOpen(false)} />
          )}
        </Flex>
      </Flex>
  );

  return (
    <Flex h="100dvh" w="100%" overflow="hidden" bg="surface.canvas" color="ink.primary">
      {/* 最左侧极窄 Icon Rail（桌面端常驻，对齐 ChatGPT 导航条） */}
      <Flex
        display={{ base: "none", md: "flex" }}
        w="52px"
        flexShrink={0}
        direction="column"
        align="center"
        justify="space-between"
        py={3}
        bg="surface.rail"
        borderRight="1px solid"
        borderColor="stroke.light"
      >
        <VStack spacing={1.5}>
          <Tooltip label={activeNav === "chat" ? (sidebarOpen ? "收起侧边栏" : "展开侧边栏") : "返回工作区"} placement="right">
            <IconButton
              aria-label="主页"
              icon={<Home size={17} />}
              size="sm"
              variant="ghost"
              color={activeNav === "chat" ? "ink.primary" : "ink.secondary"}
              bg={activeNav === "chat" ? "surface.active" : "transparent"}
              onClick={() => {
                if (activeNav !== "chat") setActiveNav("chat");
                else setSidebarOpen((v) => !v);
              }}
            />
          </Tooltip>
          <Tooltip label="新聊天" placement="right">
            <IconButton
              aria-label="新聊天"
              icon={<SquarePen size={17} />}
              size="sm"
              variant="ghost"
              color="ink.secondary"
              onClick={() => {
                setActiveNav("chat");
                if (activeProject) handleNewConversationInProject(activeProject.token);
                else createModal.onOpen();
              }}
            />
          </Tooltip>
          <Tooltip label="项目" placement="right">
            <IconButton
              aria-label="项目列表"
              icon={<Folder size={17} />}
              size="sm"
              variant="ghost"
              color={activeNav === "projects" ? "ink.primary" : "ink.secondary"}
              bg={activeNav === "projects" ? "surface.active" : "transparent"}
              onClick={() => setActiveNav("projects")}
            />
          </Tooltip>
          <Tooltip label="定时任务" placement="right">
            <IconButton
              aria-label="定时任务"
              icon={<Clock size={17} />}
              size="sm"
              variant="ghost"
              color={activeNav === "schedules" ? "ink.primary" : "ink.secondary"}
              bg={activeNav === "schedules" ? "surface.active" : "transparent"}
              onClick={() => setActiveNav("schedules")}
            />
          </Tooltip>
          {activeProject && (
            <Tooltip label="执行环境（虚拟机 / 本机连接器）" placement="right">
              <IconButton
                aria-label="执行环境"
                icon={<LayoutGrid size={17} />}
                size="sm"
                variant="ghost"
                color="ink.secondary"
                onClick={() => {
                  setRuntimeTargetProject({ token: activeProject.token, name: activeProject.name });
                  runtimeModal.onOpen();
                }}
              />
            </Tooltip>
          )}
        </VStack>

        <VStack spacing={2.5}>
          <UserAccountMenu user={user} loadingUser={false} showWorkspaceSettings compact />
        </VStack>
      </Flex>

      {/* 根据最左 Icon Rail 选择渲染对应主视图（对话区始终保活不卸载，避免切换视图中断生成） */}
      {activeNav === "projects" && (
        <ProjectsDirectoryView
          projects={projects}
          pinnedTokens={pinnedProjectTokens}
          getProjectRuntime={(token) => runtimeByProject[token] || loadProjectRuntimeConfig(token)}
          onSelectProject={(token) => {
            handleSelectProject(token);
            setActiveNav("chat");
          }}
          onCreateProject={createModal.onOpen}
          onTogglePin={togglePinProject}
          onOpenSettings={(project) => {
            setEditingProject(project);
            settingsModal.onOpen();
          }}
          onOpenRuntime={(project) => {
            setRuntimeTargetProject({ token: project.token, name: project.name });
            runtimeModal.onOpen();
          }}
          onRequestDelete={(project) => {
            setPendingDeleteProject({ token: project.token, name: project.name });
            deleteConfirmModal.onOpen();
          }}
        />
      )}
      {activeNav === "schedules" && (
        <SchedulesView
          currentChatId={visibleChatId}
          chats={projects.flatMap(project => project.conversations.map(chat => ({
            token: project.token, id: chat.id, label: project.name + " / " + chat.title,
          })))}
          onSelectConversation={selectScheduleConversation}
          conversation={scheduleConversation && activeProject?.token === scheduleConversation.token ? conversationPane : null}
          onOpen={(token, chatId) => { handleSelectConversation(token, chatId); setActiveNav("chat"); }}
        />
      )}
      <Flex
        flex="1"
        minW={0}
        minH={0}
        position="relative"
        display={activeNav === "chat" ? "flex" : "none"}
      >
        {/* 次级侧边栏（1:1 对齐 ChatGPT 左侧栏） */}
          {sidebarOpen ? (
        <Flex
          position={{ base: "absolute", md: "relative" }}
          insetY={0}
          left={0}
          zIndex={3}
          boxShadow={{ base: "xl", md: "none" }}
          w={{ base: "min(280px, 85vw)", md: "244px" }}
          flexShrink={0}
          direction="column"
          bg="surface.sidebar"
          borderRight="1px solid"
          borderColor="stroke.light"
        >
          <Flex px={3.5} pt={3} pb={2} align="center" justify="space-between">
            <HStack spacing={2.5} minW={0}>
              <Box as="img" src="/icon/logo.svg" w="30px" h="30px" borderRadius="8px" alt="伯仁" flexShrink={0} />
              <Text fontWeight="600" fontSize="16px" color="ink.primary" noOfLines={1}>
                伯仁
              </Text>
            </HStack>
            <HStack spacing={0.5}>
              <Tooltip label="搜索">
                <IconButton
                  aria-label="搜索项目或会话"
                  icon={<Search size={15} />}
                  size="xs"
                  variant="ghost"
                  color="ink.secondary"
                  onClick={() => {
                    setSearchOpen((v) => !v);
                    if (searchOpen) setSearchQuery("");
                  }}
                />
              </Tooltip>
              <Tooltip label="收起侧边栏">
                <IconButton
                  aria-label="收起侧边栏"
                  icon={<PanelLeftClose size={15} />}
                  size="xs"
                  variant="ghost"
                  color="ink.secondary"
                  onClick={() => setSidebarOpen(false)}
                />
              </Tooltip>
            </HStack>
          </Flex>

          {searchOpen && (
            <Box px={3} pb={2}>
              <InputGroup size="sm">
                <InputLeftElement pointerEvents="none">
                  <Search size={13} color="#8f8f8f" />
                </InputLeftElement>
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索项目或会话..."
                  fontSize="13px"
                  autoFocus
                />
              </InputGroup>
            </Box>
          )}

          <Box px={2} pb={2}>
            <Button
              size="sm"
              w="full"
              justifyContent="flex-start"
              fontWeight="400"
              fontSize="13.5px"
              variant="ghost"
              borderRadius="10px"
              px={2.5}
              leftIcon={<SquarePen size={15} />}
              onClick={() => {
                if (activeProject) handleNewConversationInProject(activeProject.token);
                else createModal.onOpen();
              }}
            >
              新聊天
            </Button>
          </Box>

          <Box flex="1" overflowY="auto" px={2} pb={4}>
            {loadingProjects ? (
              <Flex justify="center" py={8}>
                <Spinner size="sm" color="gray.500" />
              </Flex>
            ) : filteredProjects.length === 0 ? (
              <VStack py={8} spacing={2.5} px={3} textAlign="center">
                <Text fontSize="13px" color="ink.muted">
                  {searchQuery.trim() ? "没有找到匹配结果" : "暂无项目"}
                </Text>
                <Button size="xs" variant="outline" leftIcon={<Plus size={13} />} onClick={createModal.onOpen}>
                  新建项目
                </Button>
              </VStack>
            ) : (
              <VStack align="stretch" spacing={2}>
                {/* 按项目文件夹分类展示对话（类似文件夹与文件树） */}
                <Box>
                  <HStack justify="space-between" px={2.5} pb={1.5}>
                    <Text fontSize="11.5px" fontWeight="500" color="ink.muted">
                      项目
                    </Text>
                    <Tooltip label="新建项目">
                      <IconButton
                        aria-label="新建项目"
                        icon={<FolderPlus size={13} />}
                        size="xs"
                        variant="ghost"
                        color="ink.muted"
                        _hover={{ color: "ink.primary" }}
                        onClick={createModal.onOpen}
                      />
                    </Tooltip>
                  </HStack>
                  <VStack align="stretch" spacing={0.5}>
                    {(showAllProjects || searchQuery.trim() ? filteredProjects : filteredProjects.slice(0, 8)).map((project) => {
                      const isActiveProject = activeToken === project.token && !visibleChatId;
                      const isExpanded = Boolean(expandedProjects[project.token]) || Boolean(searchQuery.trim());
                      const projectRuntime =
                        runtimeByProject[project.token] || loadProjectRuntimeConfig(project.token);
                      const isConnectorProject = projectRuntime.sandboxKind === "connector";

                      return (
                        <Box key={project.token}>
                          <Flex
                            align="center"
                            justify="space-between"
                            px={2}
                            py={1.5}
                            borderRadius="10px"
                            cursor="pointer"
                            bg={isActiveProject ? "surface.active" : "transparent"}
                            _hover={{ bg: isActiveProject ? "surface.active" : "surface.hover", "& .proj-more": { opacity: 1 } }}
                            onClick={() => handleSelectProject(project.token)}
                          >
                            <HStack spacing={1.5} minW={0} flex="1">
                              <IconButton
                                aria-label={isExpanded ? "收起项目" : "展开项目"}
                                icon={isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                size="xs"
                                variant="ghost"
                                minW="20px"
                                h="20px"
                                color="ink.muted"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleProjectExpand(project.token);
                                }}
                              />
                              <Box color="ink.secondary" flexShrink={0}>
                                {isConnectorProject ? (
                                  <HardDrive size={15} />
                                ) : isExpanded ? (
                                  <FolderOpen size={15} />
                                ) : (
                                  <Folder size={15} />
                                )}
                              </Box>
                              <Text
                                fontSize="13.5px"
                                fontWeight={isActiveProject || activeToken === project.token ? "500" : "400"}
                                color="ink.primary"
                                noOfLines={1}
                              >
                                {project.name}
                              </Text>
                            </HStack>

                            <HStack
                              spacing={0.5}
                              className="proj-more"
                              opacity={0}
                              transition="opacity 0.12s"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Tooltip label="在此项目新建对话">
                                <IconButton
                                  aria-label="在此项目新建对话"
                                  icon={<Plus size={13} />}
                                  size="xs"
                                  variant="ghost"
                                  onClick={() => handleNewConversationInProject(project.token)}
                                />
                              </Tooltip>
                              <Menu placement="bottom-end" isLazy>
                                <MenuButton
                                  as={IconButton}
                                  aria-label="项目更多操作"
                                  icon={<MoreHorizontal size={14} />}
                                  size="xs"
                                  variant="ghost"
                                />
                                <MenuList minW="160px">
                                  <MenuItem
                                    icon={<SquarePen size={14} />}
                                    onClick={() => handleNewConversationInProject(project.token)}
                                  >
                                    新建对话
                                  </MenuItem>
                                  <MenuItem
                                    icon={<Pencil size={14} />}
                                    onClick={() => {
                                      setEditingProject(project);
                                      settingsModal.onOpen();
                                    }}
                                  >
                                    项目设置与说明
                                  </MenuItem>
                                  <MenuItem
                                    icon={<SlidersHorizontal size={14} />}
                                    onClick={() => {
                                      setRuntimeTargetProject({ token: project.token, name: project.name });
                                      runtimeModal.onOpen();
                                    }}
                                  >
                                    执行环境设置
                                  </MenuItem>
                                  <MenuDivider />
                                  <MenuItem
                                    icon={<Trash2 size={14} />}
                                    color="red.600"
                                    onClick={() => {
                                      setPendingDeleteProject({ token: project.token, name: project.name });
                                      deleteConfirmModal.onOpen();
                                    }}
                                  >
                                    删除项目
                                  </MenuItem>
                                </MenuList>
                              </Menu>
                            </HStack>
                          </Flex>

                          <Collapse in={isExpanded} animateOpacity>
                            <VStack
                              align="stretch"
                              spacing={0.5}
                              ml={4}
                              pl={2.5}
                              mt={0.5}
                              mb={1}
                              borderLeft="1px solid"
                              borderColor="stroke.light"
                            >
                              {project.conversations.length === 0 ? (
                                <Text
                                  fontSize="12px"
                                  color="ink.muted"
                                  px={2.5}
                                  py={1}
                                  cursor="pointer"
                                  _hover={{ color: "ink.primary" }}
                                  onClick={() => handleNewConversationInProject(project.token)}
                                >
                                  + 新建对话
                                </Text>
                              ) : (
                                project.conversations.map((conv) => {
                                  const selected =
                                    activeToken === project.token && visibleChatId === conv.id;
                                  return (
                                    <Flex
                                      key={`${project.token}-${conv.id}`}
                                      align="center"
                                      justify="space-between"
                                      px={2}
                                      py={1.5}
                                      borderRadius="8px"
                                      cursor="pointer"
                                      bg={selected ? "surface.active" : "transparent"}
                                      _hover={{
                                        bg: selected ? "surface.active" : "surface.hover",
                                        "& .conv-del": { opacity: 1 },
                                      }}
                                      onClick={() => handleSelectConversation(project.token, conv.id)}
                                    >
                                      <HStack spacing={2} minW={0} flex="1">
                                        <Box color="ink.muted" flexShrink={0}>
                                          <MessageSquare size={13} />
                                        </Box>
                                        <Text
                                          fontSize="13px"
                                          color="ink.primary"
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
                                        color="ink.muted"
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
                            </VStack>
                          </Collapse>
                        </Box>
                      );
                    })}
                    {!searchQuery.trim() && filteredProjects.length > 8 && (
                      <Text
                        fontSize="12.5px"
                        color="ink.muted"
                        px={2.5}
                        py={1}
                        cursor="pointer"
                        _hover={{ color: "ink.primary" }}
                        onClick={() => setShowAllProjects((v) => !v)}
                      >
                        {showAllProjects ? "收起" : "展开显示全部项目"}
                      </Text>
                    )}
                  </VStack>
                </Box>
              </VStack>
            )}
          </Box>
          <Box
            display={{ base: "block", md: "none" }}
            px={2}
            py={2}
            borderTop="1px solid"
            borderColor="stroke.light"
          >
            <UserAccountMenu user={user} loadingUser={false} showWorkspaceSettings />
          </Box>
        </Flex>
      ) : null}

      {activeNav !== "schedules" && conversationPane}
      </Flex>

      {/* 新建项目弹窗 */}
      <AppDialog
        isOpen={createModal.isOpen}
        onClose={createModal.onClose}
        title="新建项目"
        subtitle="为一组相关的对话、文件和工作环境创建独立空间"
        initialFocusRef={newProjectNameRef}
        size="md"
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreateProject();
        }}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={createModal.onClose}>
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={creatingProject}
              isDisabled={!newProjectName.trim()}
            >
              创建项目
            </Button>
          </>
        }
      >
        <VStack align="stretch" spacing={4}>
          <FormControl isRequired>
            <FormLabel fontSize="13px" fontWeight="500" color="ink.primary">
              项目名称
            </FormLabel>
            <Input
              ref={newProjectNameRef}
              size="md"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) {
                  e.preventDefault();
                }
              }}
              placeholder="例如：财报分析、Bore 开发"
            />
          </FormControl>

          <FormControl>
            <FormLabel fontSize="13px" fontWeight="500" color="ink.primary">
              项目说明（可选）
            </FormLabel>
            <Textarea
              size="sm"
              rows={2}
              value={newProjectDesc}
              onChange={(e) => setNewProjectDesc(e.target.value)}
              placeholder="描述项目目标或工作约定"
            />
          </FormControl>
        </VStack>
      </AppDialog>

      {/* 删除项目二次确认弹窗（安全按钮默认获焦） */}
      <AppDialog
        isOpen={deleteConfirmModal.isOpen}
        onClose={deleteConfirmModal.onClose}
        title="删除项目？"
        initialFocusRef={cancelDeleteRef}
        size="sm"
        footer={
          <>
            <Button ref={cancelDeleteRef} variant="ghost" size="sm" onClick={deleteConfirmModal.onClose}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (!pendingDeleteProject) return;
                const target = pendingDeleteProject;
                deleteConfirmModal.onClose();
                void handleDeleteProject(target.token, target.name);
              }}
            >
              确认删除
            </Button>
          </>
        }
      >
        <Text fontSize="13.5px" color="ink.secondary" lineHeight="1.6">
          确定要删除项目「<strong>{pendingDeleteProject?.name}</strong>」吗？该项目下的所有会话和云端工作区文件将被永久删除，且无法恢复。
        </Text>
      </AppDialog>

      {/* 项目执行环境配置弹窗 */}
      {runtimeTargetProject && (
        <WorkspaceRuntimeModal
          isOpen={runtimeModal.isOpen}
          onClose={() => { runtimeModal.onClose(); void fetchPairedDevices(); }}
          projectName={runtimeTargetProject.name}
          projectToken={runtimeTargetProject.token}
          config={
            runtimeByProject[runtimeTargetProject.token] ||
            loadProjectRuntimeConfig(runtimeTargetProject.token)
          }
          onSave={(next) => handleSaveRuntimeConfig(runtimeTargetProject.token, next)}
          onTestConnector={handleTestConnector}
          cloudHostStatus={cloudHostStatus}
        />
      )}

      {/* 项目设置与说明弹窗 */}
      <ProjectSettingsModal
        isOpen={settingsModal.isOpen}
        onClose={settingsModal.onClose}
        project={editingProject}
        onSave={handleSaveProjectSettings}
      />
    </Flex>
  );
}
