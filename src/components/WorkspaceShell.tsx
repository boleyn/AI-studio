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
import { Box, Flex, IconButton, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import FileExplorerPanel from "./workspace/FileExplorerPanel";
import FilePreviewPanel, { isPreviewableFile } from "./workspace/FilePreviewPanel";
import MonacoSandpackEditor from "./workspace/MonacoSandpackEditor";
import SkillDetailPreview from "./workspace/SkillDetailPreview";
import SkillMarkdownEditor from "./workspace/SkillMarkdownEditor";
import MyTooltip from "./ui/MyTooltip";
import { FullscreenEnterIcon, FullscreenExitIcon } from "./common/Icon";
import { DownloadIcon, RunIcon, SaveIcon, ShareIcon } from "./common/Icon";
import type { SaveStatus } from "./CodeChangeListener";

type ActiveView = "preview" | "code" | "logs";

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
  saveStatus?: SaveStatus;
  onManualPreview?: () => void;
  onManualSave?: () => void;
  onManualDownload?: () => void;
  onManualShare?: () => void;
  shareLabel?: string;
  shareAriaLabel?: string;
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
  saveStatus = "idle",
  onManualPreview,
  onManualSave,
  onManualDownload,
  onManualShare,
  shareLabel = "分享",
  shareAriaLabel = "分享",
  customStatusBadge,
}: WorkspaceShellProps) => {
  const { sandpack } = useSandpack();
  const { logs } = useSandpackConsole({ resetOnPreviewRestart: true });
  const runtimeErrorMessage = useErrorMessage();
  const loadingState = useLoadingOverlayState();

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
  const isLogsView = activeView === "logs";
  const isCompilePanelOpen =
    !isSkillsMode &&
    !isLogsView &&
    activeView === "code" &&
    compileErrorMessages.length > 0;
  const activeFile = showEmptyEditorState ? "" : sandpack.activeFile || "";
  const isSkillMarkdown = /\/SKILL\.md$/i.test(activeFile);
  const previewable = isPreviewableFile(activeFile);
  const rawFileEntry = (sandpack.files as Record<string, unknown>)[activeFile];
  const activeFileCode =
    typeof rawFileEntry === "string"
      ? rawFileEntry
      : rawFileEntry && typeof rawFileEntry === "object" && "code" in rawFileEntry
      ? String((rawFileEntry as { code?: unknown }).code ?? "")
      : "";
  const fileLanguageLabel = (() => {
    const ext = activeFile.split(".").pop()?.toLowerCase() || "";
    const map: Record<string, string> = {
      js: "JavaScript",
      jsx: "JavaScript JSX",
      ts: "TypeScript",
      tsx: "TypeScript JSX",
      json: "JSON",
      css: "CSS",
      scss: "SCSS",
      html: "HTML",
      md: "Markdown",
      yml: "YAML",
      yaml: "YAML",
      xml: "XML",
      py: "Python",
      go: "Go",
      java: "Java",
    };
    return map[ext] || "Plain Text";
  })();
  const headerActions = (
    <Flex align="center" gap={1.5} flexShrink={0}>
      {!isSkillsMode ? (
        <MyTooltip label="预览">
          <IconButton
            aria-label="预览"
            size="sm"
            variant="ghost"
            icon={<RunIcon />}
            onClick={() => {
              onManualPreview?.();
              onChangeView("preview");
            }}
          />
        </MyTooltip>
      ) : null}
      <MyTooltip label="下载项目">
        <IconButton
          aria-label="下载项目"
          size="sm"
          variant="ghost"
          icon={<DownloadIcon />}
          onClick={onManualDownload}
          isDisabled={!onManualDownload}
        />
      </MyTooltip>
      <MyTooltip label={shareLabel}>
        <IconButton
          aria-label={shareAriaLabel}
          size="sm"
          variant="ghost"
          icon={<ShareIcon />}
          onClick={onManualShare}
          isDisabled={!onManualShare}
        />
      </MyTooltip>
      <MyTooltip
        label={
          saveStatus === "saving"
            ? "保存中..."
            : saveStatus === "saved"
            ? "已保存"
            : saveStatus === "error"
            ? "保存失败"
            : "保存"
        }
      >
        <IconButton
          aria-label="保存"
          size="sm"
          variant="ghost"
          icon={<SaveIcon />}
          onClick={onManualSave}
          isLoading={saveStatus === "saving"}
          isDisabled={saveStatus === "saving" || !onManualSave}
        />
      </MyTooltip>
      {customStatusBadge ? (
        <Box
          as="button"
          type="button"
          onClick={() => {
            if (!customStatusBadge.clickable) return;
            customStatusBadge.onClick?.();
          }}
          px={2}
          py={0.5}
          borderRadius="999px"
          bg="rgba(100,218,122,0.12)"
          color="#28823b"
          fontSize="12px"
          fontWeight="700"
        >
          {customStatusBadge.text}
        </Box>
      ) : null}
    </Flex>
  );
  return (
    <Flex
      as="section"
      direction="column"
      flex="1"
      h="100%"
      minH="0"
      border="1px solid rgba(255,255,255,0.75)"
      borderTop="0"
      borderLeft="0"
      borderTopLeftRadius={0}
      borderBottomLeftRadius={0}
      borderTopRightRadius={0}
      borderBottomRightRadius={0}
      bg="#f7f8fc"
      backdropFilter="none"
      boxShadow="none"
      overflow="hidden"
    >
      <Flex direction="column" flex="1" minH="0" h="100%">
        <Box
          position="relative"
          flex="1"
          minH="0"
          display="flex"
          overflow="hidden"
          bg="#f7f8fc"
        >
          <SandpackLayout
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              display: activeView === "preview" ? "none" : "flex",
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
            <Flex direction="column" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
              <Flex
                align="center"
                borderBottom="1px solid #dbe2ec"
                bg="#f6f8fc"
                px={3}
                py={2}
                minH="62px"
                boxSizing="border-box"
                flexShrink={0}
              >
                <Flex flex="1" minW="0" align="center" gap={2} overflowX="auto" py={1} px={0.5}>
                  {openTabs.map((filePath) => {
                    const active = activeFile === filePath;
                    const label = filePath.split("/").pop() || filePath;
                    return (
                      <Flex
                        key={filePath}
                        align="center"
                        border="1px solid"
                        borderColor={active ? "var(--ws-accent-border)" : "var(--ws-border)"}
                        bg={active ? "var(--ws-tab-active-bg)" : "transparent"}
                        color={active ? "var(--ws-accent)" : "var(--ws-text-subtle)"}
                        borderRadius="12px"
                        px={2.5}
                        py={1.5}
                        gap={2}
                        maxW="260px"
                        flexShrink={0}
                        transition="background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease"
                        _hover={{
                          bg: active ? "var(--ws-tab-active-bg)" : "var(--ws-surface-muted)",
                          color: active ? "var(--ws-accent)" : "var(--ws-text-main)",
                          borderColor: active ? "var(--ws-accent-border)" : "var(--ws-border-strong)",
                        }}
                      >
                        <Box
                          as="button"
                          type="button"
                          onClick={() => handleOpenFile(filePath)}
                          title={filePath}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "inherit",
                            fontSize: "14px",
                            lineHeight: 1.2,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: "180px",
                          }}
                        >
                          {label}
                        </Box>
                        <Box
                          as="button"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleCloseTab(filePath);
                          }}
                          title={`关闭 ${label}`}
                          style={{
                            border: "none",
                            background: "var(--ws-surface-muted)",
                            color: "inherit",
                            fontSize: "14px",
                            lineHeight: 1,
                            cursor: "pointer",
                            width: "18px",
                            height: "18px",
                            borderRadius: "999px",
                          }}
                        >
                          ×
                        </Box>
                      </Flex>
                    );
                  })}
                </Flex>
                <Flex marginLeft="auto">{headerActions}</Flex>
              </Flex>
              <Box style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
              <Box style={{ flex: 1, minHeight: 0, position: "relative", height: "100%" }}>
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
                {isLogsView ? (
                  <SandpackConsole
                    style={{
                      width: "100%",
                      height: "100%",
                      maxHeight: "100%",
                      overflow: "auto",
                    }}
                  />
                ) : previewable ? (
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
                    borderTop: isCompilePanelOpen ? "1px solid rgba(203,213,225,0.85)" : "0",
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
              </Box>
              <Flex
                align="center"
                justify="space-between"
                gap={3}
                px={4}
                minH="36px"
                borderTop="1px solid #dbe2ec"
                bg="#f6f8fc"
                color="#586579"
                fontSize="12px"
                fontFamily='"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace'
                letterSpacing="0.01em"
                flexShrink={0}
              >
                <Flex align="center" gap={4} minW={0}>
                  <Flex align="center" gap={1.5}>
                    <Box w="7px" h="7px" borderRadius="full" bg={compileStatus === "error" ? "#ef4444" : "#16a34a"} />
                    <Text as="span">{compileStatus === "error" ? "错误" : "就绪"}</Text>
                  </Flex>
                  <Text as="span">
                    {saveStatus === "saving" ? "保存中" : saveStatus === "error" ? "保存失败" : "已保存"}
                  </Text>
                </Flex>
                <Flex align="center" gap={5} color="#4b5563">
                  <Text as="span">UTF-8</Text>
                  <Text as="span">{fileLanguageLabel}</Text>
                  {compileStatus === "compiling" ? (
                    <Flex align="center" gap={1.5}>
                      <Box w="6px" h="6px" borderRadius="full" bg="#32a549" />
                      <Text as="span" color="#28823b">构建中</Text>
                    </Flex>
                  ) : null}
                  {compileStatus === "error" ? (
                    <Flex align="center" gap={1.5}>
                      <Box w="6px" h="6px" borderRadius="full" bg="#ef4444" />
                      <Text as="span" color="#b91c1c">编译错误</Text>
                    </Flex>
                  ) : null}
                  <MyTooltip label={isPreviewFullscreen ? "退出全屏" : "全屏预览"}>
                    <IconButton
                      aria-label={isPreviewFullscreen ? "退出全屏" : "全屏预览"}
                      icon={isPreviewFullscreen ? <FullscreenExitIcon /> : <FullscreenEnterIcon />}
                      size="xs"
                      variant="ghost"
                      onClick={handleTogglePreviewFullscreen}
                      isDisabled={activeView !== "preview"}
                      opacity={activeView === "preview" ? 1 : 0.6}
                    />
                  </MyTooltip>
                </Flex>
              </Flex>
            </Flex>
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
                <SkillDetailPreview
                  files={sandpack.files as Record<string, string | { code?: unknown }>}
                  activeFile={activeFile}
                  onSelectFile={handleOpenFile}
                />
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
