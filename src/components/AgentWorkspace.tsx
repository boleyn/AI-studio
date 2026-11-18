import { deviceDisplayName } from "@/shared/localDevice/displayName";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserAccountMenu } from "./UserAccountMenu";
import {
  Box,
  Button,
  Collapse,
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
  Radio,
  RadioGroup,
  Text,
  Tooltip,
  useDisclosure,
  useToast,
  VStack,
} from "@chakra-ui/react";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Clock,
  Cloud,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Home,
  LayoutGrid,
  Library,
  Laptop,
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
import { createConversation } from "@features/chat/services/conversations";
import LibraryView from "./agent-workspace/LibraryView";
import WorkspaceFilesPanel from "./agent-workspace/WorkspaceFilesPanel";
import ProjectWorkspaceSelect from "./agent-workspace/ProjectWorkspaceSelect";
import DeviceManagementModal from "./agent-workspace/DeviceManagementModal";
import type { DeviceAccess, ProjectWorkspace } from "@/types/projectWorkspace";
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
  workspace?: ProjectWorkspace;
  createdAt: string;
  updatedAt: string;
  conversations: ConversationItem[];
};

type AgentWorkspaceProps = {
  initialProjectToken?: string;
  initialProjectName?: string;
  initialFiles?: Record<string, { code: string }>;
};


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
  const router = useRouter();
  const { query } = router;
  const visibleChatId = typeof query.conversation === "string" ? query.conversation : activeChatId;
  const visibleChatIdRef = useRef(visibleChatId);
  visibleChatIdRef.current = visibleChatId;
  const [libraryDraft,setLibraryDraft] = useState<{chatId:string;files:File[];text?:string}>();
  const [newConvSignal, setNewConvSignal] = useState(0);

  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

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

  const devicesModal = useDisclosure();
  const [deviceAccessByProject, setDeviceAccessByProject] = useState<Record<string, DeviceAccess | undefined>>({});
  const [requestingDeviceAccess, setRequestingDeviceAccess] = useState(false);
  const activeDeviceAccess = deviceAccessByProject[activeToken];

  // 项目设置与删除确认弹窗
  const settingsModal = useDisclosure();
  const [editingProject, setEditingProject] = useState<ProjectWithConversations | null>(null);
  const editingWorkspaceDeviceId = editingProject?.workspace?.kind === "connector"
    ? editingProject.workspace.deviceId
    : undefined;
  const deleteConfirmModal = useDisclosure();
  const [pendingDeleteProject, setPendingDeleteProject] = useState<{ token: string; name: string } | null>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  type WorkspaceView = "chat" | "schedules" | "projects" | "library";
  const activeNav: WorkspaceView = query.view === "library" || query.view === "projects" || query.view === "schedules"
    ? query.view : "chat";
  const [fileChat,setFileChat] = useState<{itemId:string;chatId:string;minimized:boolean}>();
  const [fileChatWidth, setFileChatWidth] = useState(38);
  const chatPaneRef = useRef<HTMLDivElement>(null);
  const clampChatWidth = (width: number) => Math.min(65, Math.max(25, width));
  const currentFileChat = fileChat && activeNav === "library" && fileChat?.itemId === query.libraryItem &&
    fileChat.chatId === visibleChatId ? fileChat : undefined;
  const fileChatOpen = currentFileChat?.minimized === false;
  function setActiveNav(view: WorkspaceView, conversation?:string) {
    if (view === activeNav && !conversation) return;
    const nextQuery = {...router.query};
    if (conversation) nextQuery.conversation = conversation;
    if (view !== "library") {
      delete nextQuery.libraryItem;
      delete nextQuery.libraryFolder;
      delete nextQuery.librarySection;
      delete nextQuery.libraryTab;
      delete nextQuery.libraryType;
      delete nextQuery.libraryLayout;
    }
    if (view === "chat") delete nextQuery.view;
    else nextQuery.view = view;
    return router.push({pathname:router.pathname, query:nextQuery}, undefined, {shallow:true, scroll:false});
  }

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
  const [newWorkspaceKind, setNewWorkspaceKind] = useState<ProjectWorkspace["kind"]>("remote-vm");
  const [newWorkspaceDeviceId, setNewWorkspaceDeviceId] = useState("");
  const [newWorkspaceWorkdir, setNewWorkspaceWorkdir] = useState("");
  const [highlightedFolder, setHighlightedFolder] = useState("");
  const [showHiddenFolders, setShowHiddenFolders] = useState(false);
  const [choosingFolderDevice, setChoosingFolderDevice] = useState(false);
  const [deviceWorkdirs, setDeviceWorkdirs] = useState<{ deviceId: string; workdirs?: string[]; current?: string; parent?: string | null; error?: boolean }>();
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
      return list;
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

  const directoryRequest = useRef(0);
  const fetchDeviceWorkdirs = async (deviceId: string, directory?: string) => {
    if (!deviceId) return;
    setHighlightedFolder("");
    const request = ++directoryRequest.current;
    setDeviceWorkdirs({ deviceId, current: directory });
    try {
      const data = await apiJson<{ current: string; parent: string | null; children: string[] }>(
        "/core/localDevice/directories", { method: "POST", body: JSON.stringify({ deviceId, directory }) },
      );
      if (request === directoryRequest.current)
        setDeviceWorkdirs({ deviceId, current: data.current, parent: data.parent, workdirs: data.children });
    } catch {
      if (request === directoryRequest.current) setDeviceWorkdirs({ deviceId, current: directory, error: true });
    }
  };

  const closeFolderPicker = () => {
    ++directoryRequest.current;
    setDeviceWorkdirs(undefined);
    setHighlightedFolder("");
  };
  const folderName = (path: string) => path.split(/[/\\]/).filter(Boolean).pop() || path;
  const visibleFolders = (deviceWorkdirs?.workdirs || []).filter(folder => showHiddenFolders || !folderName(folder).startsWith("."));

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name || creatingProject) return;
    if (newWorkspaceKind === "connector" &&
        !pairedDevices.some(device => device.deviceId === newWorkspaceDeviceId && device.online)) {
      toast({ title: "请选择在线的本地电脑", status: "warning" });
      return;
    }
    setCreatingProject(true);
    try {
      const created = await apiJson<{ token: string; name: string }>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          workspace: newWorkspaceKind === "connector"
            ? { kind: newWorkspaceKind, deviceId: newWorkspaceDeviceId, workdir: newWorkspaceWorkdir || undefined }
            : { kind: newWorkspaceKind },
          files: {},
          dependencies: {},
        }),
      });
      setNewProjectName("");
      setNewWorkspaceKind("remote-vm");
      setNewWorkspaceDeviceId("");
      setDeviceWorkdirs(undefined);
      setNewWorkspaceWorkdir("");
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

  const selectDeviceAccess = (projectToken: string, access?: DeviceAccess) => {
    setDeviceAccessByProject(prev => ({ ...prev, [projectToken]: access }));
  };

  const requestDeviceAccess = async (projectToken: string, deviceId: string) => {
    if (requestingDeviceAccess) return;
    setRequestingDeviceAccess(true);
    try {
      const { grant } = await apiJson<{ grant: { grantId: string } }>("/core/localDevice/grant", {
        method: "POST",
        body: JSON.stringify({ action: "request", appId: projectToken, chatId: "device-access", deviceId }),
      });
      selectDeviceAccess(projectToken, { kind: "connector", deviceId, grantId: grant.grantId });
    } catch {
      toast({ title: "无法访问这台电脑，请确认连接器在线并在本机批准", status: "warning" });
    } finally {
      setRequestingDeviceAccess(false);
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

  const completionsExtraBody = useMemo(
    () => activeDeviceAccess ? { deviceAccess: activeDeviceAccess } : undefined,
    [activeDeviceAccess],
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

  const conversationPane = (
      <Flex flex="1" direction="column" minW={0} bg="#ffffff">
        {fileChatOpen && <Flex align="center" justify="space-between" px={4} h="52px"><Text fontWeight="600">聊天</Text><Button size="sm" variant="ghost" onClick={()=>setFileChat(prev=>prev && {...prev,minimized:true})}>最小化聊天窗口</Button></Flex>}
        {activeNav !== "schedules" && !fileChatOpen && (
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
                    activeProject.workspace?.kind === "connector" ? (
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
                  libraryDraft,
                  onLibraryDraftConsumed: () => setLibraryDraft(undefined),
                  deviceAccessKind: activeDeviceAccess?.kind,
                  deviceAccessLabel: activeDeviceAccess?.kind === "connector"
                    ? pairedDevices.find(device => device.deviceId === activeDeviceAccess.deviceId)?.name || "本地电脑"
                    : activeDeviceAccess?.kind === "remote-vm" ? "云电脑" : "访问设备",
                  selectedDeviceId: activeDeviceAccess?.kind === "connector" ? activeDeviceAccess.deviceId : undefined,
                  requestingDeviceAccess,
                  cloudHostStatus,
                  devices: pairedDevices,
                  onOpenHostMenu: () => { void fetchPairedDevices(); void fetchCloudHostStatus(); },
                  onClearDeviceAccess: () => selectDeviceAccess(activeProject.token),
                  onSelectCloudHost: () => selectDeviceAccess(activeProject.token, { kind: "remote-vm" }),
                  onSelectDeviceHost: (device) => void requestDeviceAccess(activeProject.token, device.deviceId),
                  onOpenDeviceManagement: devicesModal.onOpen,
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
          <Tooltip label="资料空间" placement="right">
            <IconButton aria-label="资料空间" icon={<Library size={17} />} size="sm" variant="ghost"
              bg={activeNav === "library" ? "surface.active" : "transparent"} onClick={() => setActiveNav("library")} />
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
          <Tooltip label="我的设备" placement="right">
            <IconButton aria-label="我的设备" icon={<LayoutGrid size={17} />} size="sm"
              variant="ghost" color="ink.secondary" onClick={devicesModal.onOpen} />
          </Tooltip>
        </VStack>

        <VStack spacing={2.5}>
          <UserAccountMenu user={user} loadingUser={false} showWorkspaceSettings compact />
        </VStack>
      </Flex>

      {/* 根据最左 Icon Rail 选择渲染对应主视图（对话区始终保活不卸载，避免切换视图中断生成） */}
      {activeNav === "library" && <LibraryView fileChatOpen={fileChatOpen} resumeFileChat={currentFileChat?.minimized ? ()=>setFileChat({...currentFileChat,minimized:false}) : undefined} projects={projects} onProject={token => { handleSelectProject(token); setActiveNav("chat"); }} onChat={async (files,text,itemId) => {
        let token = activeProject?.token || projects[0]?.token;
        if (!token) {
          const existing = await apiJson<ProjectWithConversations[]>("/projects?includeConversations=1");
          token = existing[0]?.token;
          if (!token) {
            const created = await apiJson<{token:string}>("/projects", {
              method:"POST", body:JSON.stringify({name:"个人工作区", files:{}, dependencies:{}})
            });
            token = created.token;
          }
          await fetchProjects();
        }
        const chat = itemId && fileChat?.itemId === itemId && fileChat.chatId === activeChatId ? {id:fileChat.chatId} : await createConversation(token,[]);
        if (!chat) throw new Error("创建对话失败");
        setLibraryDraft({chatId:chat.id,files,text});
        if (itemId) setFileChat({itemId,chatId:chat.id,minimized:false});
        else setFileChat(undefined);
        await setActiveNav(itemId ? "library" : "chat", chat.id);
        handleSelectConversation(token,chat.id);
      }} onBack={() => setActiveNav("chat")} onOpen={(token, chatId) => { handleSelectConversation(token, chatId); setActiveNav("chat", chatId); }} />}
      {activeNav === "projects" && (
        <ProjectsDirectoryView
          projects={projects}
          pinnedTokens={pinnedProjectTokens}
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
          onOpen={(token, chatId) => { handleSelectConversation(token, chatId); setActiveNav("chat", chatId); }}
        />
      )}
      <Flex
        ref={chatPaneRef}
        flex={fileChatOpen ? {base:"1",md:`0 0 ${fileChatWidth}%`} : "1"}
        minW={0}
        minH={0}
        position={fileChatOpen ? {base:"absolute",md:"relative"} : "relative"}
        display={activeNav === "chat" || fileChatOpen ? "flex" : "none"}
        {...(fileChatOpen ? {role:"region", "aria-label":"聊天", inset:{base:0,md:"auto"},zIndex:4,bg:"white",borderLeftWidth:"1px"} : {})}
      >
        {fileChatOpen && <Box role="separator" aria-label="调整聊天宽度" aria-orientation="vertical"
          aria-valuemin={25} aria-valuemax={65} aria-valuenow={fileChatWidth} aria-valuetext={fileChatWidth + "%"}
          tabIndex={0} display={{base:"none",md:"block"}} position="absolute" insetY={0} left="-4px" w="8px"
          zIndex={5} cursor="col-resize" style={{touchAction:"none"}} _focusVisible={{outline:"2px solid currentColor"}}
          onPointerDown={event => {
            if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const bounds = chatPaneRef.current?.parentElement?.getBoundingClientRect();
            if (bounds?.width) setFileChatWidth(clampChatWidth(Math.round(100 * (bounds.right - event.clientX) / bounds.width)));
          }}
          onKeyDown={event => {
            const widths: Record<string, number> = {ArrowLeft:fileChatWidth + 1, ArrowRight:fileChatWidth - 1, Home:25, End:65};
            if (Object.prototype.hasOwnProperty.call(widths, event.key)) {
              event.preventDefault();
              setFileChatWidth(clampChatWidth(widths[event.key]));
            }
          }}
        />}
        {/* 次级侧边栏（1:1 对齐 ChatGPT 左侧栏） */}
          {sidebarOpen && !fileChatOpen ? (
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
                      const isConnectorProject = project.workspace?.kind === "connector";

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
            <Button variant="ghost" size="sm" leftIcon={<Library size={16} />} onClick={() => { closeMobileSidebar(); setActiveNav("library"); }}>资料空间</Button>
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
        initialFocusRef={newProjectNameRef}
        size="sm"
        cornerRadius="10px"
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
              loadingText="正在创建"
              isDisabled={!newProjectName.trim()}
            >
              创建项目
            </Button>
          </>
        }
      >
        <VStack align="stretch" spacing={4}>
          <FormControl id="new-project-name" isRequired>
            <FormLabel fontSize="13px" fontWeight="500" color="ink.primary">
              项目名称
            </FormLabel>
            <Input
              name="projectName"
              ref={newProjectNameRef}
              size="sm"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) {
                  e.preventDefault();
                }
              }}
              placeholder="输入项目名称"
            />
          </FormControl>

          <FormControl as="fieldset">
            <FormLabel as="legend" fontSize="13px" color="ink.primary">工作空间</FormLabel>
            <RadioGroup name="workspaceKind" value={newWorkspaceKind} onChange={(value) => {
              setNewWorkspaceKind(value === "connector" ? "connector" : "remote-vm");
              setChoosingFolderDevice(false);
              if (value === "connector") void fetchPairedDevices().then(list => {
                const online = list?.filter(device => device.online);
                if (online?.length === 1) setNewWorkspaceDeviceId(previous => previous || online[0].deviceId);
              });
            }}>
              <HStack spacing={1} p={1} bg="surface.rail" borderRadius="8px" sx={{
                "& > label": {
                  flex: 1,
                  minHeight: "36px",
                  justifyContent: "center",
                  borderRadius: "5px",
                  _hover: { bg: "surface.hover" },
                  "&[data-checked]": { bg: "surface.canvas", boxShadow: "sm" },
                  "& .chakra-radio__control": { display: "none" },
                  "&:focus-within": { outline: "2px solid", outlineColor: "ink.primary", outlineOffset: "1px" },
                },
              }}>
                {([
                  { value: "remote-vm", label: "云电脑", Icon: Cloud },
                  { value: "connector", label: "本地电脑", Icon: Laptop },
                ] as const).map(({ value, label, Icon }) => (
                  <Radio key={value} value={value} colorScheme="gray" spacing={0}>
                    <HStack spacing={1.5}>
                      <Icon aria-hidden="true" size={15} />
                      <Text fontSize="13px" fontWeight={newWorkspaceKind === value ? "600" : "500"}>{label}</Text>
                    </HStack>
                  </Radio>
                ))}
              </HStack>
            </RadioGroup>
          </FormControl>
          {newWorkspaceKind === "connector" && (
            <VStack align="stretch" spacing={3} pt={3} borderTop="1px solid" borderColor="stroke.light">
              <HStack align="center" spacing={2}>
                <Text id="new-project-device-label" fontSize="13px" w="64px" flexShrink={0}>设备</Text>
                <Box flex={1} minW={0}>
                  <ProjectWorkspaceSelect labelId="new-project-device-label" value={newWorkspaceDeviceId}
                    placeholder="选择设备" emptyMessage="暂无设备" onOpen={() => void fetchPairedDevices()}
                    options={pairedDevices.map(device => ({
                      value: device.deviceId, label: device.name,
                      status: device.online ? "在线" : "离线", disabled: !device.online,
                    }))}
                    onChange={deviceId => {
                      setChoosingFolderDevice(false);
                      setNewWorkspaceDeviceId(deviceId);
                      setNewWorkspaceWorkdir("");
                      ++directoryRequest.current;
                      setDeviceWorkdirs(undefined);
                    }} />
                </Box>
                <Button type="button" size="xs" variant="ghost" flexShrink={0} onClick={devicesModal.onOpen}>管理</Button>
              </HStack>
              <HStack align="center" spacing={2}>
                <Text id="new-project-workdir-label" fontSize="13px" w="64px" flexShrink={0}>工作目录</Text>
                <Box flex={1} minW={0}>
                  <Button type="button" size="sm" variant="outline" w="full" justifyContent="space-between"
                    aria-expanded={choosingFolderDevice || !!deviceWorkdirs}
                    rightIcon={<ChevronDown size={14} />} onClick={() => {
                      if (deviceWorkdirs) { ++directoryRequest.current; setDeviceWorkdirs(undefined); }
                      else if (newWorkspaceDeviceId) void fetchDeviceWorkdirs(newWorkspaceDeviceId, newWorkspaceWorkdir || undefined);
                      else {
                        setChoosingFolderDevice(!choosingFolderDevice);
                        void fetchPairedDevices();
                      }
                    }}>
                    <Text noOfLines={1}>{newWorkspaceWorkdir || "选择文件夹"}</Text>
                  </Button>
                </Box>
              </HStack>
              {choosingFolderDevice && !newWorkspaceDeviceId && (
                <VStack align="stretch" spacing={1}>
                  {pairedDevices.filter(device => device.online).map(device => (
                    <Button key={device.deviceId} type="button" variant="outline" size="sm" onClick={() => {
                      setChoosingFolderDevice(false);
                      setNewWorkspaceDeviceId(device.deviceId);
                      setNewWorkspaceWorkdir("");
                      void fetchDeviceWorkdirs(device.deviceId);
                    }}>{device.name}</Button>
                  ))}
                  {!pairedDevices.some(device => device.online) && <Button type="button" size="sm" variant="ghost" onClick={devicesModal.onOpen}>暂无在线设备 · 管理设备</Button>}
                </VStack>
              )}
            </VStack>
          )}
        </VStack>
      </AppDialog>

      <AppDialog isOpen={!!deviceWorkdirs && createModal.isOpen} title="选择工作目录" size="md" cornerRadius="8px"
        onClose={closeFolderPicker} footer={<>
          <Button variant="ghost" size="sm" onClick={closeFolderPicker}>取消</Button>
          <Button variant="primary" size="sm" isDisabled={!deviceWorkdirs?.workdirs || !(highlightedFolder || deviceWorkdirs.current)}
            onClick={() => { setNewWorkspaceWorkdir(highlightedFolder || deviceWorkdirs?.current || ""); closeFolderPicker(); }}>选定文件夹</Button>
        </>}>
        <HStack pb={2} borderBottomWidth="1px">
          <IconButton aria-label="上一级" icon={<ArrowUp size={15}/>} size="sm" variant="ghost"
            isDisabled={deviceWorkdirs?.parent == null} onClick={() => void fetchDeviceWorkdirs(newWorkspaceDeviceId, deviceWorkdirs!.parent!)}/>
          <Text flex={1} fontSize="sm" overflowWrap="anywhere">{deviceWorkdirs?.current || "设备"}</Text>
          <Button size="xs" variant="ghost" aria-pressed={showHiddenFolders} onClick={() => setShowHiddenFolders(!showHiddenFolders)}>
            {showHiddenFolders ? "收起隐藏项" : "显示隐藏项"}
          </Button>
        </HStack>
        <Box h="min(280px, 40dvh)" overflowY="auto" py={1}>
          {visibleFolders.map(folder => <HStack key={folder} spacing={0} borderRadius="4px"
            bg={highlightedFolder === folder ? "surface.hover" : undefined} _hover={{ bg: "surface.hover" }}>
            <Button flex={1} minW={0} justifyContent="flex-start" size="sm" variant="ghost" fontWeight="normal"
              aria-pressed={highlightedFolder === folder} leftIcon={<Folder size={16}/>}
              onClick={() => setHighlightedFolder(folder)} onDoubleClick={() => void fetchDeviceWorkdirs(newWorkspaceDeviceId, folder)}>
              <Text noOfLines={1}>{folderName(folder)}</Text>
            </Button>
            <IconButton variant="ghost" size="sm" aria-label={`打开 ${folderName(folder)}`} icon={<ChevronRight size={15}/>}
              onClick={() => void fetchDeviceWorkdirs(newWorkspaceDeviceId, folder)}/>
          </HStack>)}
          {deviceWorkdirs?.error ? <Button variant="ghost" size="sm" onClick={() => void fetchDeviceWorkdirs(newWorkspaceDeviceId, deviceWorkdirs.current)}>读取失败，重试</Button>
            : !deviceWorkdirs?.workdirs ? <Spinner size="sm" m={3}/> : !visibleFolders.length && <Text p={3} color="ink.secondary" fontSize="sm">没有可显示的子文件夹</Text>}
        </Box>
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

      <DeviceManagementModal isOpen={devicesModal.isOpen} onClose={() => {
        devicesModal.onClose();
        void fetchPairedDevices();
      }} />

      {/* 项目设置与说明弹窗 */}
      <ProjectSettingsModal
        isOpen={settingsModal.isOpen}
        onClose={settingsModal.onClose}
        project={editingProject}
        workspaceDeviceName={pairedDevices.find(device => device.deviceId === editingWorkspaceDeviceId)?.name}
        onSave={handleSaveProjectSettings}
      />
    </Flex>
  );
}
