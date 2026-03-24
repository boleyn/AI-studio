import {
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
  openFileRequest?: string | null;
  onOpenFileRequestHandled?: () => void;
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
  skillsValidationLog?: {
    status: "idle" | "validating" | "pass" | "fail";
    issueCount?: number;
    message?: string;
    updatedAt?: string;
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

type RuntimeLogLevel = "info" | "warn" | "error";
type RuntimeLogItem = {
  id: string;
  timestamp: string;
  level: RuntimeLogLevel;
  source: "bundler" | "console" | "runtime";
  message: string;
};

const MAX_RUNTIME_LOGS = 300;

const inferRuntimeLevel = (type: string, text: string): RuntimeLogLevel => {
  const value = `${type} ${text}`.toLowerCase();
  if (/error|failed|exception|crash|syntax/.test(value)) return "error";
  if (/warn|warning/.test(value)) return "warn";
  return "info";
};

const extractBundlerText = (message: unknown): { type: string; text: string } => {
  if (!message || typeof message !== "object") {
    const text = toLogText(message).trim();
    return { type: "unknown", text };
  }
  const record = message as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "unknown";
  const textCandidate = [
    record.message,
    record.title,
    record.error,
    record.reason,
    record.details,
    record.status,
    record.event,
  ]
    .map((item) => toLogText(item).trim())
    .find((item) => item.length > 0);

  return { type, text: textCandidate || toLogText(message).trim() };
};

const WorkspaceShell = ({
  token,
  status,
  error,
  activeView,
  onChangeView,
  openFileRequest = null,
  onOpenFileRequestHandled,
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
  skillsValidationLog,
}: WorkspaceShellProps) => {
  const { sandpack, listen } = useSandpack();
  const { logs } = useSandpackConsole({ resetOnPreviewRestart: false });
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
  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeLogItem[]>([]);
  const lastConsoleCountRef = useRef(0);
  const isSkillsMode = workspaceMode === "skills";

  const pushRuntimeLog = useCallback((item: Omit<RuntimeLogItem, "id" | "timestamp">) => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString("zh-CN", { hour12: false });
    const id = `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    setRuntimeLogs((prev) => {
      const next = [...prev, { ...item, id, timestamp }];
      return next.length > MAX_RUNTIME_LOGS ? next.slice(next.length - MAX_RUNTIME_LOGS) : next;
    });
  }, []);

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

  useEffect(() => {
    if (isSkillsMode) return;
    const stopListening = listen((message) => {
      const parsed = extractBundlerText(message);
      if (!parsed.text) return;
      pushRuntimeLog({
        source: "bundler",
        level: inferRuntimeLevel(parsed.type, parsed.text),
        message: `[${parsed.type}] ${parsed.text}`,
      });
    });
    return () => {
      stopListening();
    };
  }, [isSkillsMode, listen, pushRuntimeLog]);

  useEffect(() => {
    if (isSkillsMode) return;
    const start = Math.min(lastConsoleCountRef.current, logs.length);
    const nextLogs = logs.slice(start);
    if (nextLogs.length === 0) return;
    lastConsoleCountRef.current = logs.length;

    nextLogs.forEach((entry) => {
      const method = String((entry as { method?: unknown })?.method || "log").toLowerCase();
      const data = Array.isArray((entry as { data?: unknown[] })?.data)
        ? ((entry as { data?: unknown[] }).data as unknown[])
        : [];
      const text = data.map((item) => toLogText(item)).join(" ").trim();
      if (!text) return;
      pushRuntimeLog({
        source: "console",
        level: method.includes("error") ? "error" : method.includes("warn") ? "warn" : "info",
        message: text,
      });
    });
  }, [isSkillsMode, logs, pushRuntimeLog]);

  useEffect(() => {
    if (isSkillsMode) return;
    if (!runtimeErrorMessage) return;
    pushRuntimeLog({
      source: "runtime",
      level: "error",
      message: runtimeErrorMessage,
    });
  }, [isSkillsMode, pushRuntimeLog, runtimeErrorMessage]);

  useEffect(() => {
    if (isSkillsMode) return;
    if (!sandpack.error) return;
    const text = [sandpack.error.title, sandpack.error.message, sandpack.error.path]
      .filter(Boolean)
      .join(" | ");
    if (!text) return;
    pushRuntimeLog({
      source: "runtime",
      level: "error",
      message: text,
    });
  }, [isSkillsMode, pushRuntimeLog, sandpack.error]);

  const handleOpenFile = (filePath: string) => {
    if (!filePath) return;
    if (filePathFilter && !filePathFilter(filePath)) return;
    setShowEmptyEditorState(false);
    sandpack.setActiveFile(filePath);
    setOpenTabs((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
  };

  useEffect(() => {
    if (!openFileRequest) return;
    handleOpenFile(openFileRequest);
    onOpenFileRequestHandled?.();
  }, [handleOpenFile, onOpenFileRequestHandled, openFileRequest]);

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

  useEffect(() => {
    if (activeView !== "preview") return;
    const timer = window.setTimeout(() => {
      const host = previewLayerRef.current;
      if (!host) return;
      const iframe = host.querySelector("iframe[title='Sandpack Preview']") as HTMLIFrameElement | null;
      if (!iframe) return;
      iframe.setAttribute("scrolling", "no");
      iframe.style.overflow = "hidden";
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeView, sandpack.activeFile]);

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

  const isLogsView = activeView === "logs";
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
                {isLogsView ? (
                  <Flex align="center" justify="space-between" w="100%" px={0.5}>
                    <Text fontSize="sm" fontWeight="700" color="#1f2937">
                      {isSkillsMode ? "Skill 校验日志" : "实时编译日志"}
                    </Text>
                    <Text fontSize="12px" color="#64748b">
                      {isSkillsMode
                        ? skillsValidationLog?.status === "validating"
                          ? "校验中"
                          : skillsValidationLog?.status === "fail"
                          ? `失败 ${skillsValidationLog.issueCount || 0}`
                          : skillsValidationLog?.status === "pass"
                          ? "已通过"
                          : "等待校验"
                        : "Sandpack Console"}
                    </Text>
                  </Flex>
                ) : (
                  <>
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
                  </>
                )}
              </Flex>
              <Box style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
                <Box style={{ flex: 1, minHeight: 0, position: "relative", height: "100%" }}>
                  {isLogsView ? (
                    <Box
                      position="absolute"
                      inset={0}
                      bg="var(--ws-surface-strong)"
                      overflow="auto"
                      display="flex"
                      flexDirection="column"
                      px={3}
                      py={2}
                      gap={1.5}
                    >
                      {isSkillsMode ? (
                        <Flex direction="column" gap={2}>
                          <Flex
                            align="center"
                            justify="space-between"
                            px={2}
                            py={1.5}
                            borderRadius="8px"
                            border="1px solid"
                            borderColor="rgba(148,163,184,0.25)"
                            bg="rgba(15,23,42,0.03)"
                          >
                            <Text fontSize="12px" color="#475569" fontWeight="600">
                              状态
                            </Text>
                            <Text
                              fontSize="12px"
                              fontWeight="700"
                              color={
                                skillsValidationLog?.status === "fail"
                                  ? "#b91c1c"
                                  : skillsValidationLog?.status === "pass"
                                  ? "#15803d"
                                  : skillsValidationLog?.status === "validating"
                                  ? "#b45309"
                                  : "#475569"
                              }
                            >
                              {skillsValidationLog?.status === "validating"
                                ? "校验中"
                                : skillsValidationLog?.status === "fail"
                                ? `校验失败（${skillsValidationLog.issueCount || 0}）`
                                : skillsValidationLog?.status === "pass"
                                ? "校验通过"
                                : "未触发校验"}
                            </Text>
                          </Flex>
                          <Flex
                            align="flex-start"
                            gap={2}
                            px={2}
                            py={1.5}
                            borderRadius="8px"
                            border="1px solid"
                            borderColor="rgba(148,163,184,0.25)"
                            bg="rgba(255,255,255,0.86)"
                          >
                            <Text
                              fontSize="12px"
                              color="#1f2937"
                              whiteSpace="pre-wrap"
                              flex={1}
                            >
                              {skillsValidationLog?.message || "暂无校验信息，点击右上角“校验 Skills”即可检查规范。"}
                            </Text>
                          </Flex>
                          {skillsValidationLog?.updatedAt ? (
                            <Text fontSize="11px" color="#64748b" px={1}>
                              最近更新时间：{skillsValidationLog.updatedAt}
                            </Text>
                          ) : null}
                        </Flex>
                      ) : runtimeLogs.length === 0 ? (
                        <Text fontSize="12px" color="#64748b">
                          暂无日志，等待编译或运行输出...
                        </Text>
                      ) : (
                        runtimeLogs.map((item) => (
                          <Flex
                            key={item.id}
                            align="flex-start"
                            gap={2}
                            px={2}
                            py={1.5}
                            borderRadius="8px"
                            bg={
                              item.level === "error"
                                ? "rgba(239,68,68,0.08)"
                                : item.level === "warn"
                                ? "rgba(245,158,11,0.1)"
                                : "rgba(15,23,42,0.03)"
                            }
                            border="1px solid"
                            borderColor={
                              item.level === "error"
                                ? "rgba(239,68,68,0.22)"
                                : item.level === "warn"
                                ? "rgba(245,158,11,0.26)"
                                : "rgba(148,163,184,0.2)"
                            }
                          >
                            <Text
                              fontSize="11px"
                              minW="58px"
                              color="#64748b"
                              fontFamily='"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace'
                            >
                              {item.timestamp}
                            </Text>
                            <Text
                              fontSize="11px"
                              minW="52px"
                              fontWeight="700"
                              color={
                                item.level === "error"
                                  ? "#b91c1c"
                                  : item.level === "warn"
                                  ? "#b45309"
                                  : "#475569"
                              }
                            >
                              {item.source}
                            </Text>
                            <Text
                              flex={1}
                              fontSize="12px"
                              whiteSpace="pre-wrap"
                              color={
                                item.level === "error"
                                  ? "#7f1d1d"
                                  : item.level === "warn"
                                  ? "#78350f"
                                  : "#1f2937"
                              }
                            >
                              {item.message}
                            </Text>
                          </Flex>
                        ))
                      )}
                    </Box>
                  ) : (
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
                    </SandpackStack>
                  )}
                </Box>
              </Box>
              <Flex
                align="center"
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
                <Flex align="center" gap={4} minW={0} flex="1" justify="flex-start">
                  <Flex align="center" gap={1.5}>
                    <Box
                      w="7px"
                      h="7px"
                      borderRadius="full"
                      bg={
                        compileStatus === "error"
                          ? "#ef4444"
                          : compileStatus === "compiling"
                          ? "#f59e0b"
                          : "#16a34a"
                      }
                    />
                    <Text as="span">
                      {compileStatus === "error" ? "错误" : compileStatus === "compiling" ? "构建中" : "就绪"}
                    </Text>
                  </Flex>
                  <Text as="span">
                    {saveStatus === "saving" ? "保存中" : saveStatus === "error" ? "保存失败" : "已保存"}
                  </Text>
                </Flex>

                <Text
                  as="span"
                  flex="1"
                  textAlign="center"
                  color="myGray.500"
                  fontSize="10px"
                  lineHeight="1"
                >
                  AI-STUDIO · AI EBOSS · AIID
                </Text>

                <Flex align="center" gap={5} color="#4b5563" flex="1" justify="flex-end">
                  <Text as="span">UTF-8</Text>
                  <Text as="span">{fileLanguageLabel}</Text>
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
              overflow: "hidden",
            }}
            sx={{
              "&, & > .sp-stack, & > .sp-stack > *": {
                minHeight: "0 !important",
              },
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
                <Box
                  width="100%"
                  height="100%"
                  minH={0}
                  overflow="hidden"
                  sx={{
                    "& [class*='preview']": {
                      minHeight: "0 !important",
                    },
                    "& .sp-preview, & .preview": {
                      width: "100% !important",
                      height: "100% !important",
                      minHeight: "0 !important",
                      overflow: "hidden !important",
                    },
                    "& [class*='preview-container']": {
                      width: "100% !important",
                      height: "100% !important",
                      minHeight: "0 !important",
                      overflowX: "hidden !important",
                      overflowY: "hidden !important",
                    },
                    "& .sp-preview-container, & .preview-container": {
                      width: "100% !important",
                      height: "100% !important",
                      minHeight: "0 !important",
                      overflow: "hidden !important",
                    },
                    "& [class*='preview-iframe']": {
                      width: "100% !important",
                      height: "100% !important",
                      minHeight: "0 !important",
                      maxHeight: "100% !important",
                      flex: "1 1 auto !important",
                      display: "block !important",
                    },
                    "& .sp-preview-iframe, & .preview-iframe": {
                      width: "100% !important",
                      height: "100% !important",
                      minHeight: "0 !important",
                      maxHeight: "100% !important",
                      flex: "1 1 auto !important",
                    },
                    "& iframe[title='Sandpack Preview']": {
                      width: "100% !important",
                      height: "100% !important",
                      minHeight: "0 !important",
                      maxHeight: "100% !important",
                      display: "block !important",
                    },
                    "& .sp-stack": {
                      minHeight: "0 !important",
                    },
                  }}
                >
                  <SandpackPreview
                    showNavigator={false}
                    showRefreshButton={false}
                    showRestartButton={false}
                    showOpenInCodeSandbox={false}
                    style={{ width: "100%", height: "100%", overflow: "hidden" }}
                  />
                </Box>
              )}
            </SandpackStack>
            <Box position="absolute" top={2.5} right={2.5} zIndex={3}>
              <MyTooltip label={isPreviewFullscreen ? "退出全屏" : "全屏预览"}>
                <IconButton
                  aria-label={isPreviewFullscreen ? "退出全屏" : "全屏预览"}
                  icon={isPreviewFullscreen ? <FullscreenExitIcon /> : <FullscreenEnterIcon />}
                  size="sm"
                  variant="ghost"
                  bg="rgba(255,255,255,0.84)"
                  border="1px solid rgba(203,213,225,0.95)"
                  _hover={{ bg: "white", borderColor: "rgba(148,163,184,0.95)" }}
                  onClick={handleTogglePreviewFullscreen}
                />
              </MyTooltip>
            </Box>
          </Box>
        </Box>
      </Flex>
    </Flex>
  );
};

export default WorkspaceShell;
