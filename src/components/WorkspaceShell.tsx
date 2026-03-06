import {
  SandpackConsole,
  SandpackLayout,
  SandpackPreview,
  SandpackStack,
  useErrorMessage,
  useSandpack,
  useSandpackConsole,
  useLoadingOverlayState,
} from "@codesandbox/sandpack-react";
import { Box, Flex, IconButton } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import FileExplorerPanel from "./workspace/FileExplorerPanel";
import FilePreviewPanel, { isPreviewableFile } from "./workspace/FilePreviewPanel";
import MonacoSandpackEditor from "./workspace/MonacoSandpackEditor";
import SkillMarkdownEditor from "./workspace/SkillMarkdownEditor";
import WorkspaceHeader from "./workspace/WorkspaceHeader";
import MyTooltip from "./ui/MyTooltip";
import { FullscreenEnterIcon, FullscreenExitIcon } from "./common/Icon";
import Markdown from "./Markdown";

type ActiveView = "preview" | "code";

type WorkspaceShellProps = {
  token: string;
  status: "idle" | "loading" | "ready" | "error";
  error: string;
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  workspaceMode?: "project" | "skills";
  onPersistFiles?: (files: Record<string, { code: string }>) => Promise<void>;
  filePathFilter?: (path: string) => boolean;
  defaultFolderPath?: string;
  customStatusBadge?: {
    text: string;
    colorScheme: string;
    title?: string;
    clickable?: boolean;
    onClick?: () => void;
  };
};

const toLogText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const normalizeErrorLine = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const WorkspaceShell = ({
  token,
  status,
  error,
  activeView,
  onChangeView,
  workspaceMode = "project",
  onPersistFiles,
  filePathFilter,
  defaultFolderPath,
  customStatusBadge,
}: WorkspaceShellProps) => {
  const { sandpack } = useSandpack();
  const { logs } = useSandpackConsole({ resetOnPreviewRestart: true });
  const runtimeErrorMessage = useErrorMessage();
  const loadingState = useLoadingOverlayState();

  const [isCompileBadgeHovered, setIsCompileBadgeHovered] = useState(false);
  const [isCompilePanelPinned, setIsCompilePanelPinned] = useState(false);
  const [openTabs, setOpenTabs] = useState<string[]>(() =>
    sandpack.activeFile && (!filePathFilter || filePathFilter(sandpack.activeFile))
      ? [sandpack.activeFile]
      : []
  );
  const [showEmptyEditorState, setShowEmptyEditorState] = useState(false);
  const previewLayerRef = useRef<HTMLDivElement | null>(null);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);

  useEffect(() => {
    const active = sandpack.activeFile;
    if (!active || showEmptyEditorState) return;
    if (filePathFilter && !filePathFilter(active)) return;
    setOpenTabs((prev) => (prev.includes(active) ? prev : [...prev, active]));
  }, [filePathFilter, sandpack.activeFile, showEmptyEditorState]);

  useEffect(() => {
    if (!filePathFilter) return;
    setOpenTabs((prev) => prev.filter((path) => filePathFilter(path)));
    if (sandpack.activeFile && !filePathFilter(sandpack.activeFile)) {
      const fallback = Object.keys(sandpack.files).find((path) => filePathFilter(path)) || "";
      if (fallback) {
        sandpack.setActiveFile(fallback);
      } else {
        setShowEmptyEditorState(true);
      }
    }
  }, [filePathFilter, sandpack]);

  const handleOpenFile = (filePath: string) => {
    if (!filePath) return;
    if (filePathFilter && !filePathFilter(filePath)) return;
    setShowEmptyEditorState(false);
    sandpack.setActiveFile(filePath);
    setOpenTabs((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
  };

  const handleCloseTab = (filePath: string) => {
    setOpenTabs((prev) => {
      const nextTabs = prev.filter((item) => item !== filePath);
      if (sandpack.activeFile === filePath) {
        const fallback = nextTabs[nextTabs.length - 1] || "";
        if (fallback) {
          setShowEmptyEditorState(false);
          sandpack.setActiveFile(fallback);
        } else {
          setShowEmptyEditorState(true);
        }
      }
      return nextTabs;
    });
  };

  const compileErrorMessages = useMemo(() => {
    const fromLogs = logs
      .filter((entry) => {
        const method = String(entry?.method || "").toLowerCase();
        return method.includes("error");
      })
      .flatMap((entry) => {
        const data = Array.isArray(entry?.data) ? entry.data : [];
        return normalizeErrorLine(data.map((item) => toLogText(item)).join(" "));
      });

    const fromRuntime = runtimeErrorMessage ? normalizeErrorLine(runtimeErrorMessage) : [];
    const fromSandpackError = sandpack.error
      ? normalizeErrorLine(
          [sandpack.error.title, sandpack.error.message, sandpack.error.path]
            .filter(Boolean)
            .join(" ")
        )
      : [];
    const combined = [...fromSandpackError, ...fromRuntime, ...fromLogs]
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 80);

    return Array.from(new Set(combined));
  }, [logs, runtimeErrorMessage, sandpack.error]);

  useEffect(() => {
    if (compileErrorMessages.length === 0) {
      setIsCompilePanelPinned(false);
    }
  }, [compileErrorMessages.length]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!previewLayerRef.current) {
        setIsPreviewFullscreen(false);
        return;
      }
      setIsPreviewFullscreen(document.fullscreenElement === previewLayerRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  const handleTogglePreviewFullscreen = useCallback(async () => {
    const target = previewLayerRef.current;
    if (!target) return;
    try {
      if (document.fullscreenElement === target) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen();
      }
    } catch {
      // ignore fullscreen API errors
    }
  }, []);

  const compileStatus: "ready" | "compiling" | "error" =
    compileErrorMessages.length > 0
      ? "error"
      : loadingState === "LOADING" || loadingState === "PRE_FADING"
      ? "compiling"
      : "ready";

  const isSkillsMode = workspaceMode === "skills";
  const isCompilePanelOpen =
    !isSkillsMode &&
    activeView === "code" &&
    compileErrorMessages.length > 0 &&
    (isCompileBadgeHovered || isCompilePanelPinned);
  const activeFile = showEmptyEditorState ? "" : sandpack.activeFile || "";
  const isSkillMarkdown = /\/SKILL\.md$/i.test(activeFile);
  const isMarkdownFile = /\.md$/i.test(activeFile);
  const previewable = isPreviewableFile(activeFile);
  const rawFileEntry = (sandpack.files as Record<string, unknown>)[activeFile];
  const activeFileCode =
    typeof rawFileEntry === "string"
      ? rawFileEntry
      : rawFileEntry && typeof rawFileEntry === "object" && "code" in rawFileEntry
      ? String((rawFileEntry as { code?: unknown }).code ?? "")
      : "";
  const previewMarkdownContent = isSkillMarkdown
    ? activeFileCode.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "")
    : activeFileCode;

  return (
    <Flex
      as="section"
      direction="column"
      flex="1"
      h="100%"
      minH="0"
      border="1px solid rgba(255,255,255,0.75)"
      borderTopLeftRadius={0}
      borderBottomLeftRadius={0}
      borderTopRightRadius="2xl"
      borderBottomRightRadius="2xl"
      bg="rgba(255,255,255,0.75)"
      backdropFilter="blur(22px)"
      boxShadow="0 24px 42px -28px rgba(15, 23, 42, 0.35)"
      overflow="hidden"
    >
      <Flex direction="column" flex="1" minH="0" h="100%">
        <Box>
          <WorkspaceHeader
            activeView={activeView}
            onChangeView={onChangeView}
            status={status}
            error={error}
            compileStatus={status === "ready" ? compileStatus : "ready"}
            compileErrorCount={compileErrorMessages.length}
            onCompileBadgeHoverChange={setIsCompileBadgeHovered}
            onCompileBadgeToggle={() => {
              if (compileErrorMessages.length === 0) return;
              setIsCompilePanelPinned((prev) => !prev);
            }}
            tabs={openTabs}
            activeFile={activeFile}
            onSelectTab={handleOpenFile}
            onCloseTab={handleCloseTab}
            hideStatusBadge={isSkillsMode}
            customStatusBadge={customStatusBadge}
          />
        </Box>
        <Box
          position="relative"
          flex="1"
          minH="0"
          display="flex"
          overflow="hidden"
          bg="var(--ws-surface-muted)"
        >
          <SandpackLayout
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              display: activeView === "code" ? "flex" : "none",
              border: "none",
              borderRadius: 0,
              boxShadow: "none",
              background: "transparent",
            }}
          >
            <FileExplorerPanel
              token={token}
              onOpenFile={handleOpenFile}
              workspaceMode={workspaceMode}
              onPersistFiles={onPersistFiles}
              filePathFilter={filePathFilter}
              defaultFolderPath={defaultFolderPath}
            />
            <Box style={{ flex: 1, minWidth: 0, position: "relative" }}>
              <SandpackStack
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                  width: "100%",
                  height: "100%",
                }}
              >
                {previewable ? (
                  <FilePreviewPanel
                    token={token}
                    activeFile={activeFile}
                    sourceCode={activeFileCode}
                  />
                ) : isSkillsMode && isSkillMarkdown ? (
                  <SkillMarkdownEditor
                    activeFile={activeFile}
                    code={activeFileCode}
                    onChangeCode={(nextCode) => {
                      if (!activeFile) return;
                      sandpack.updateFile(activeFile, nextCode, true);
                    }}
                  />
                ) : (
                  <MonacoSandpackEditor
                    activeFile={activeFile}
                    code={activeFileCode}
                    onChangeCode={(nextCode) => {
                      if (!activeFile) return;
                      sandpack.updateFile(activeFile, nextCode, true);
                    }}
                  />
                )}
                <Box
                  style={{
                    maxHeight: isCompilePanelOpen ? "35%" : "0%",
                    opacity: isCompilePanelOpen ? 1 : 0,
                    overflow: "hidden",
                    borderTop: isCompilePanelOpen ? "1px solid rgba(203,213,225,0.85)" : "1px solid transparent",
                    transition: "max-height 0.2s ease, opacity 0.2s ease, border-color 0.2s ease",
                    pointerEvents: isCompilePanelOpen ? "auto" : "none",
                  }}
                >
                  <SandpackConsole
                    style={{
                      maxHeight: "100%",
                      overflow: "auto",
                    }}
                  />
                </Box>
              </SandpackStack>
            </Box>
          </SandpackLayout>
          <Box
            ref={previewLayerRef}
            style={{
              flex: 1,
              minWidth: 0,
              position: "relative",
              display: activeView === "preview" ? "flex" : "none",
            }}
            >
              <Box position="absolute" top={3} right={3} zIndex={4} pointerEvents="auto">
                <MyTooltip
                  label={isPreviewFullscreen ? "最小化预览" : "全屏预览"}
                  placement="left"
                  portalProps={{ containerRef: previewLayerRef }}
                >
                  <IconButton
                    aria-label={isPreviewFullscreen ? "最小化预览" : "全屏预览"}
                    icon={isPreviewFullscreen ? <FullscreenExitIcon /> : <FullscreenEnterIcon />}
                    size="sm"
                    variant="ghost"
                    color="var(--ws-text-main)"
                    bg="rgba(255,255,255,0.94)"
                    border="1px solid rgba(148,163,184,0.52)"
                    boxShadow="0 8px 18px -12px rgba(15,23,42,0.45)"
                    borderRadius="10px"
                    _hover={{ bg: "rgba(255,255,255,1)" }}
                    onClick={handleTogglePreviewFullscreen}
                  />
                </MyTooltip>
              </Box>
              <SandpackStack
                style={{
                  position: "absolute",
                inset: 0,
                display: "flex",
                minHeight: 0,
                width: "100%",
                height: "100%",
                overflow: "hidden",
              }}
            >
              {isSkillsMode ? (
                <Box
                  h="100%"
                  overflow="auto"
                  bg="var(--ws-surface-strong)"
                  p={0}
                >
                  {!activeFile ? (
                    <Flex h="100%" align="center" justify="center">
                      <Box
                        px={5}
                        py={4}
                        borderRadius="12px"
                        border="1px solid rgba(203,213,225,0.95)"
                        bg="white"
                        fontSize="sm"
                        color="var(--ws-text-subtle)"
                      >
                        先在左侧选择一个 SKILL.md 文件进行预览
                      </Box>
                    </Flex>
                  ) : isMarkdownFile ? (
                    <Box
                      h="100%"
                      w="100%"
                      px={{ base: 4, md: 5 }}
                      py={{ base: 3, md: 4 }}
                      overflow="auto"
                    >
                      {previewMarkdownContent.trim() ? (
                        <Markdown source={previewMarkdownContent} />
                      ) : (
                        <Box fontSize="sm" color="var(--ws-text-subtle)">
                          当前 Markdown 内容为空
                        </Box>
                      )}
                    </Box>
                  ) : (
                    <Flex h="100%" align="center" justify="center">
                      <Box
                        px={5}
                        py={4}
                        borderRadius="12px"
                        border="1px solid rgba(203,213,225,0.95)"
                        bg="white"
                      >
                        <Box fontSize="sm" color="var(--ws-text-subtle)">
                          技能模式预览仅支持 Markdown 文件
                        </Box>
                      </Box>
                    </Flex>
                  )}
                </Box>
              ) : (
                <SandpackPreview
                  showOpenInCodeSandbox={false}
                  style={{ width: "100%", height: "100%", overflow: "hidden" }}
                />
              )}
            </SandpackStack>
          </Box>
        </Box>
      </Flex>
    </Flex>
  );
};

export default WorkspaceShell;
