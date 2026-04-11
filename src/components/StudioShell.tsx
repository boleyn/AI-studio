import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Box,
  Button,
  Flex,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Text,
  useToast,
} from "@chakra-ui/react";
import { SandpackProvider, type SandpackPredefinedTemplate } from "@codesandbox/sandpack-react";
import dynamic from "next/dynamic";
import { githubLight } from "@codesandbox/sandpack-themes";
import { useRouter } from "next/router";

import TopBar from "./TopBar";
import { withAuthHeaders } from "@features/auth/client/authClient";
const ChatPanel = dynamic(() => import("../features/chat/components/ChatPanel"), {
  ssr: false,
});
import WorkspaceShell from "./WorkspaceShell";
import type { SaveStatus } from "./CodeChangeListener";
import CodeChangeListener from "./CodeChangeListener";
import SandpackCompileListener from "./SandpackCompileListener";
import { buildSandpackCustomSetup } from "@shared/sandpack/registry";
import { listConversations } from "@features/chat/services/conversations";

type SandpackFile = { code: string; hidden?: boolean };
export type SandpackFiles = Record<string, SandpackFile>;

type ProjectStatus = "idle" | "loading" | "ready" | "error";

type StudioShellProps = {
  initialToken?: string;
  initialProject?: {
    token: string;
    name: string;
    template: SandpackPredefinedTemplate;
    files: SandpackFiles;
    dependencies?: Record<string, string>;
  };
};

type ActiveView = "preview" | "code" | "logs";
type ShareMode = "editable" | "preview";

const DEFAULT_TEMPLATE: SandpackPredefinedTemplate = "react";
const EMPTY_PROJECT_PLACEHOLDER_PATH = "/.ai-studio-empty.js";
const EMPTY_PROJECT_PROVIDER_FILES: SandpackFiles = {
  [EMPTY_PROJECT_PLACEHOLDER_PATH]: {
    code: "export default function EmptyProjectPlaceholder() { return null; }",
    hidden: true,
  },
};
const ENTRY_CANDIDATES = [
  "/index.tsx",
  "/index.jsx",
  "/index.ts",
  "/index.js",
  "/main.tsx",
  "/main.jsx",
  "/main.ts",
  "/main.js",
  "/App.tsx",
  "/App.jsx",
  "/App.ts",
  "/App.js",
] as const;
const EXTERNAL_RESOURCE_HTML_CANDIDATES = ["/public/index.html", "/index.html"] as const;
const hasUserVisibleFiles = (input: SandpackFiles | null | undefined): boolean =>
  Object.keys(input || {}).some(
    (filePath) => filePath !== "/package.json" && filePath !== EMPTY_PROJECT_PLACEHOLDER_PATH
  );

const extractExternalResources = (files: SandpackFiles): string[] => {
  const resources = new Set<string>();
  const htmlPath = EXTERNAL_RESOURCE_HTML_CANDIDATES.find((path) => Boolean(files[path]));
  if (!htmlPath) return [];
  const html = files[htmlPath]?.code || "";
  if (!html) return [];

  const scriptSrcRegex = /<script[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  const stylesheetRegex = /<link[^>]*\brel\s*=\s*["']stylesheet["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

  let match: RegExpExecArray | null = null;
  while ((match = scriptSrcRegex.exec(html)) !== null) {
    const url = (match[1] || "").trim();
    if (/^https?:\/\//i.test(url)) resources.add(url);
  }
  while ((match = stylesheetRegex.exec(html)) !== null) {
    const url = (match[1] || "").trim();
    if (/^https?:\/\//i.test(url)) resources.add(url);
  }

  return Array.from(resources);
};

const normalizeFiles = (rawFiles: unknown): SandpackFiles | null => {
  if (!rawFiles || typeof rawFiles !== "object") {
    return null;
  }

  const output: SandpackFiles = {};
  Object.entries(rawFiles as Record<string, unknown>).forEach(([path, value]) => {
    if (typeof value === "string") {
      output[path] = { code: value };
      return;
    }
    if (
      value &&
      typeof value === "object" &&
      "code" in value &&
      typeof (value as SandpackFile).code === "string"
    ) {
      output[path] = value as SandpackFile;
    }
  });

  return output;
};

const toSortedFilePaths = (input: SandpackFiles | null | undefined): string[] =>
  Object.keys(input || {}).sort((a, b) => a.localeCompare(b));

const StudioShell = ({ initialToken = "", initialProject }: StudioShellProps) => {
  const router = useRouter();
  const toast = useToast();
  const [token, setToken] = useState(initialToken);
  const [status, setStatus] = useState<ProjectStatus>(() => {
    if (initialProject && initialProject.token === initialToken) {
      return "ready";
    }
    return initialToken ? "loading" : "idle";
  });
  const [error, setError] = useState("");
  const [template, setTemplate] = useState<SandpackPredefinedTemplate>(
    initialProject?.template || DEFAULT_TEMPLATE
  );
  const [files, setFiles] = useState<SandpackFiles | null>(
    initialProject?.files || null
  );
  const latestFilesRef = useRef<SandpackFiles | null>(initialProject?.files || null);
  const [dependencies, setDependencies] = useState<Record<string, string>>(
    initialProject?.dependencies || {}
  );
  const [activeView, setActiveView] = useState<ActiveView>("code");
  const [projectName, setProjectName] = useState<string>(initialProject?.name || "");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [openSkillsSignal, setOpenSkillsSignal] = useState(0);
  const [topSearchConversations, setTopSearchConversations] = useState<Array<{ id: string; title: string }>>([]);
  const [topSearchOpenFilePath, setTopSearchOpenFilePath] = useState<string | null>(null);
  const [shareLinks, setShareLinks] = useState<Record<ShareMode, string>>({
    editable: "",
    preview: "",
  });
  const [chatFileOptions, setChatFileOptions] = useState<string[]>(() =>
    toSortedFilePaths(initialProject?.files || null)
  );

  const loadProject = useCallback(async (requestedToken: string) => {
    if (!requestedToken) {
      setError("需要一个项目 ID (di) 才能加载项目。你也可以用 /project/<di> 作为路径。");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const response = await fetch(`/api/code?token=${encodeURIComponent(requestedToken)}`, {
        headers: withAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(`服务返回 ${response.status}`);
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const nextTemplate = payload.template || (payload.sandpack as Record<string, unknown>)?.template;
      const normalizedTemplate =
        nextTemplate === "vite-react" || nextTemplate === "vite-react-ts"
          ? DEFAULT_TEMPLATE
          : ((nextTemplate as SandpackPredefinedTemplate) || DEFAULT_TEMPLATE);
      const nextFiles = normalizeFiles(
        (payload as Record<string, unknown>).files ||
          (payload as Record<string, { files?: unknown }>).sandpack?.files
      );
      const nextDependencies =
        (payload as Record<string, unknown>).dependencies ||
        (payload as Record<string, { dependencies?: Record<string, string> }>)
          .sandpack?.dependencies ||
        {};
      const nextName = (payload.name as string) || "未命名项目";

      setTemplate(normalizedTemplate);
      setFiles(nextFiles);
      latestFilesRef.current = nextFiles;
      setChatFileOptions(toSortedFilePaths(nextFiles));
      setDependencies(nextDependencies as Record<string, string>);
      setProjectName(nextName);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败，请检查后端接口。 ");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    // 当initialToken变化时，更新token并加载项目（首次进入也需要加载）
    if (!initialToken) {
      return;
    }
    if (initialProject && initialProject.token === initialToken) {
      if (initialToken !== token) {
        setToken(initialToken);
      }
      return;
    }
    if (initialToken !== token) {
      setToken(initialToken);
    }
    loadProject(initialToken);
  }, [initialToken, token, loadProject, initialProject]);

  const sandpackFiles = useMemo<SandpackFiles>(() => files || {}, [files]);
  const hasRealFiles = useMemo(() => hasUserVisibleFiles(sandpackFiles), [sandpackFiles]);
  const runtimeTransientPaths = useMemo(() => {
    const paths = [EMPTY_PROJECT_PLACEHOLDER_PATH];
    if (!hasRealFiles) {
      paths.push("/package.json");
    }
    return paths;
  }, [hasRealFiles]);
  const shouldShowPath = useCallback(
    (filePath: string) => !runtimeTransientPaths.includes(filePath),
    [runtimeTransientPaths]
  );
  const providerFiles = useMemo<SandpackFiles>(
    () => (hasRealFiles ? sandpackFiles : EMPTY_PROJECT_PROVIDER_FILES),
    [hasRealFiles, sandpackFiles]
  );
  const providerTemplate = undefined;
  const topSearchFilePaths = useMemo(
    () => Object.keys(sandpackFiles).filter(shouldShowPath),
    [sandpackFiles, shouldShowPath]
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const trimmedName = projectName.trim();
    if (trimmedName) {
      document.title = trimmedName;
    }
  }, [projectName]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      const data = await listConversations(token);
      if (!active) return;
      setTopSearchConversations(data.map((item) => ({ id: item.id, title: item.title || "未命名对话" })));
    })();
    return () => {
      active = false;
    };
  }, [token, openSkillsSignal]);

  const customSetup = useMemo(() => {
    return buildSandpackCustomSetup(dependencies);
  }, [dependencies]);
  const providerEntry = useMemo(() => {
    for (const path of ENTRY_CANDIDATES) {
      if (providerFiles[path]) return path;
    }
    return EMPTY_PROJECT_PLACEHOLDER_PATH;
  }, [providerFiles]);
  const providerCustomSetup = useMemo(() => {
    return {
      ...customSetup,
      entry: providerEntry,
    };
  }, [customSetup, providerEntry]);
  const providerExternalResources = useMemo(() => extractExternalResources(providerFiles), [providerFiles]);

  const handleManualSave = useCallback(async () => {
    // 手动保存：只保存文件内容
    const currentFiles = latestFilesRef.current || files;
    if (!token || !currentFiles) {
      return;
    }

    setSaveStatus("saving");

    try {
      const response = await fetch(`/api/code?token=${encodeURIComponent(token)}&action=files`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
        body: JSON.stringify({
          files: currentFiles,
          name: projectName.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`保存失败: ${response.status}`);
      }

      setSaveStatus("saved");
    } catch (error) {
      console.error("Failed to save project:", error);
      setSaveStatus("error");
    }
  }, [token, files, projectName]);

  const handleDownload = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetch(`/api/code?token=${encodeURIComponent(token)}&action=download`, {
        headers: withAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`下载失败: ${response.status}`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const utf8FilenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const asciiFilenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const filename = utf8FilenameMatch?.[1]
        ? decodeURIComponent(utf8FilenameMatch[1])
        : asciiFilenameMatch?.[1] || `${projectName || "project"}.zip`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download project zip:", error);
    }
  }, [token, projectName]);

  const createShareLink = useCallback(async (mode: ShareMode): Promise<string> => {
    if (!token) {
      throw new Error("缺少项目 token");
    }

    const response = await fetch("/api/share", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...withAuthHeaders(),
      },
      body: JSON.stringify({ token, mode }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `创建分享失败: ${response.status}`);
    }

    const payload = (await response.json()) as { url: string };
    if (!payload.url) {
      throw new Error("服务未返回分享链接");
    }
    return payload.url;
  }, [token]);

  const handleOpenShareModal = useCallback(async () => {
    if (!token) {
      toast({
        title: "当前项目无法分享",
        description: "缺少项目 token",
        status: "error",
        duration: 2500,
        isClosable: true,
      });
      return;
    }

    setIsShareModalOpen(true);
    setShareLoading(true);
    try {
      const [editable, preview] = await Promise.all([
        createShareLink("editable"),
        createShareLink("preview"),
      ]);
      setShareLinks({ editable, preview });
    } catch (error) {
      toast({
        title: "生成分享链接失败",
        description: error instanceof Error ? error.message : "未知错误",
        status: "error",
        duration: 2800,
        isClosable: true,
      });
    } finally {
      setShareLoading(false);
    }
  }, [createShareLink, token, toast]);

  const handleCopyShareLink = useCallback((mode: ShareMode, inputId: string) => {
    const link = shareLinks[mode];
    if (!link) return;

    const copy = async () => {
      if (!navigator.clipboard || !window.isSecureContext) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(link);
    };

    copy()
      .then(() => {
        toast({
          title: "链接已复制",
          status: "success",
          duration: 1500,
          isClosable: true,
        });
      })
      .catch(() => {
        const input = document.getElementById(inputId) as HTMLInputElement | null;
        input?.focus();
        input?.select();
        toast({
          title: "当前环境不支持自动复制",
          description: "已选中链接，请手动复制",
          status: "info",
          duration: 3000,
          isClosable: true,
        });
      });
  }, [shareLinks, toast]);

  const handleFilesChange = useCallback((nextFiles: SandpackFiles) => {
    latestFilesRef.current = nextFiles;
    setChatFileOptions(toSortedFilePaths(nextFiles));
    const prevHasReal = hasUserVisibleFiles(files);
    const nextHasReal = hasUserVisibleFiles(nextFiles);
    // Avoid SandpackProvider remount loops: only sync state when empty/non-empty mode changes.
    if (prevHasReal !== nextHasReal) {
      setFiles(nextFiles);
    }
  }, [files]);

  const handleAgentFilesUpdated = useCallback((updated: Record<string, { code: string }>) => {
    const merged = {
      ...(latestFilesRef.current || files || {}),
      ...updated,
    };
    latestFilesRef.current = merged;
    setChatFileOptions(toSortedFilePaths(merged));
    setFiles(merged);
  }, [files]);

  const handleProjectNameChange = useCallback(async (newName: string) => {
    if (!token || !newName.trim() || newName === projectName) {
      return;
    }

    try {
      // 只传需要更新的字段
      const response = await fetch(`/api/code?token=${encodeURIComponent(token)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
        body: JSON.stringify({
          name: newName.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(`更新失败: ${response.status}`);
      }

      // 更新项目名称状态
      setProjectName(newName.trim());
      
      // 返回成功，让TopBar知道保存成功
      return true;
    } catch (error) {
      console.error("Failed to update project name:", error);
      throw error; // 抛出错误，让TopBar处理
    }
  }, [token, projectName]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const [workspaceHeight, setWorkspaceHeight] = useState("100%");
  const [chatWidth, setChatWidth] = useState(546);
  const resizingRef = useRef(false);

  const updateChatWidthByClientX = useCallback((clientX: number) => {
    const containerLeft = containerRef.current?.getBoundingClientRect().left || 0;
    const next = Math.min(728, Math.max(300, clientX - containerLeft));
    setChatWidth(next);
  }, []);

  const finishResizing = useCallback(() => {
    resizingRef.current = false;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  const handleResizerPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizingRef.current = true;
    updateChatWidthByClientX(event.clientX);
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [updateChatWidthByClientX]);

  const handleResizerPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return;
    updateChatWidthByClientX(event.clientX);
  }, [updateChatWidthByClientX]);

  const handleResizerPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishResizing();
  }, [finishResizing]);

  useEffect(() => {
    return () => {
      finishResizing();
    };
  }, [finishResizing]);

  useEffect(() => {
    const container = containerRef.current;
    const main = mainRef.current;
    if (!container || !main) {
      return;
    }

    const updateHeight = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const mainTop = main.getBoundingClientRect().top;
      const containerStyles = getComputedStyle(container);
      const paddingBottom = parseFloat(containerStyles.paddingBottom || "0") || 0;
      const borderBottom = parseFloat(containerStyles.borderBottomWidth || "0") || 0;
      const nextHeight = Math.max(0, viewportHeight - mainTop - paddingBottom - borderBottom);
      setWorkspaceHeight(`${nextHeight}px`);
    };

    updateHeight();
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(container);
    observer.observe(main);
    window.addEventListener("resize", updateHeight);
    window.visualViewport?.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
      window.visualViewport?.removeEventListener("resize", updateHeight);
    };
  }, []);

  return (
    <Box
      position="relative"
      minH="100dvh"
      h="100dvh"
      overflow="hidden"
      bg="#0f131b"
      backgroundImage="radial-gradient(circle at 1px 1px, rgba(173,184,203,0.22) 1px, transparent 0)"
      backgroundSize="18px 18px"
      p={0}
    >
      <Flex
        ref={containerRef}
        direction="column"
        minH="100dvh"
        h="100dvh"
        align="stretch"
        justify="flex-start"
        px={0}
        py={0}
        position="relative"
        zIndex={1}
        gap={0}
        overflow="hidden"
        boxSizing="border-box"
        borderRadius={0}
        border="none"
        bg="#f3f4fa"
        boxShadow="none"
      >
        <TopBar
          projectName={projectName}
          activeView={activeView}
          onChangeView={setActiveView}
          onBack={() => {
            void router.push("/");
          }}
          onOpenSettings={() => setOpenSkillsSignal((prev) => prev + 1)}
          onProjectNameChange={handleProjectNameChange}
          searchFiles={topSearchFilePaths}
          searchConversations={topSearchConversations}
          onOpenFileFromSearch={(filePath) => {
            setActiveView("code");
            setTopSearchOpenFilePath(filePath);
          }}
          onOpenConversationFromSearch={(conversationId) => {
            void router.replace(
              {
                pathname: router.pathname,
                query: { ...router.query, conversation: conversationId },
              },
              undefined,
              { shallow: true }
            );
          }}
        />

        <SandpackProvider
          template={providerTemplate}
          files={providerFiles}
          customSetup={providerCustomSetup}
          theme={githubLight}
          options={{
            autorun: true,
            recompileMode: "delayed",
            recompileDelay: 600,
            experimental_enableServiceWorker: true,
            externalResources: providerExternalResources,
          }}
        >
          <CodeChangeListener
            token={token}
            template={providerTemplate || template}
            dependencies={providerCustomSetup?.dependencies || {}}
            transientPaths={runtimeTransientPaths}
            onSaveStatusChange={setSaveStatus}
            onFilesChange={handleFilesChange}
          />
          <SandpackCompileListener token={token} />
          <Flex ref={mainRef} as="main" align="stretch" gap={0} flex="1" minH="0" h={workspaceHeight}>
            <Box
              flex="0 0 auto"
              minW="300px"
              maxW="728px"
              w={`${chatWidth}px`}
              alignSelf="stretch"
              h="100%"
              minH="0"
            >
              <ChatPanel
                token={token}
                onFilesUpdated={handleAgentFilesUpdated}
                height="100%"
                openSkillsSignal={openSkillsSignal}
                fileOptions={chatFileOptions}
              />
            </Box>
            <Box
              w="10px"
              ml="-5px"
              mr="-5px"
              cursor="col-resize"
              bg="transparent"
              position="relative"
              flexShrink={0}
              _hover={{ bg: "transparent" }}
              onPointerDown={handleResizerPointerDown}
              onPointerMove={handleResizerPointerMove}
              onPointerUp={handleResizerPointerUp}
              onLostPointerCapture={finishResizing}
            />
            <WorkspaceShell
              token={token}
              status={status}
              error={error}
              activeView={activeView}
              onChangeView={setActiveView}
              openFileRequest={topSearchOpenFilePath}
              onOpenFileRequestHandled={() => setTopSearchOpenFilePath(null)}
              filePathFilter={shouldShowPath}
              saveStatus={saveStatus}
              onManualPreview={() => setActiveView("preview")}
              onManualSave={handleManualSave}
              onManualDownload={handleDownload}
              onManualShare={handleOpenShareModal}
            />
          </Flex>
        </SandpackProvider>
      </Flex>

      <Modal isOpen={isShareModalOpen} onClose={() => setIsShareModalOpen(false)} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>项目分享</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={4}>
            <Text color="myGray.600" fontSize="sm" mb={3}>
              当前为开发环境（非 HTTPS）时可能无法自动复制，可直接手动复制下方链接。
            </Text>

            <Box border="1px solid" borderColor="myGray.200" borderRadius="md" p={3} mb={3}>
              <Text fontWeight="700" fontSize="sm" mb={1}>可编辑分享（需登录）</Text>
              <Text color="myGray.500" fontSize="xs" mb={2}>接收方登录后自动创建项目副本，不影响原项目。</Text>
              <Flex gap={2}>
                <Input
                  id="share-link-editable"
                  readOnly
                  value={shareLinks.editable}
                  isDisabled={shareLoading || !shareLinks.editable}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  minW="84px"
                  onClick={() => handleCopyShareLink("editable", "share-link-editable")}
                  isDisabled={shareLoading || !shareLinks.editable}
                >
                  复制
                </Button>
              </Flex>
            </Box>

            <Box border="1px solid" borderColor="myGray.200" borderRadius="md" p={3}>
              <Text fontWeight="700" fontSize="sm" mb={1}>预览分享（免登录）</Text>
              <Text color="myGray.500" fontSize="xs" mb={2}>接收方可直接访问并查看实时预览。</Text>
              <Flex gap={2}>
                <Input
                  id="share-link-preview"
                  readOnly
                  value={shareLinks.preview}
                  isDisabled={shareLoading || !shareLinks.preview}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  minW="84px"
                  onClick={() => handleCopyShareLink("preview", "share-link-preview")}
                  isDisabled={shareLoading || !shareLinks.preview}
                >
                  复制
                </Button>
              </Flex>
            </Box>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default StudioShell;
