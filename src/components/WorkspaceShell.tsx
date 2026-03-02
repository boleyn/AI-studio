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
import { Box, Flex } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";

import FileExplorerPanel from "./workspace/FileExplorerPanel";
import MonacoSandpackEditor from "./workspace/MonacoSandpackEditor";
import WorkspaceHeader from "./workspace/WorkspaceHeader";

type ActiveView = "preview" | "code";

type WorkspaceShellProps = {
  token: string;
  status: "idle" | "loading" | "ready" | "error";
  error: string;
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  workspaceHeight: string;
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
  workspaceHeight,
}: WorkspaceShellProps) => {
  const { sandpack } = useSandpack();
  const { logs } = useSandpackConsole({ resetOnPreviewRestart: true });
  const runtimeErrorMessage = useErrorMessage();
  const loadingState = useLoadingOverlayState();

  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [isCompileBadgeHovered, setIsCompileBadgeHovered] = useState(false);
  const [isCompilePanelPinned, setIsCompilePanelPinned] = useState(false);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) {
      return;
    }
    const updateHeight = () => {
      setHeaderHeight(header.getBoundingClientRect().height);
    };
    updateHeight();
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

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

  const compileStatus: "ready" | "compiling" | "error" =
    compileErrorMessages.length > 0
      ? "error"
      : loadingState === "LOADING" || loadingState === "PRE_FADING"
      ? "compiling"
      : "ready";

  const isCompilePanelOpen =
    activeView === "code" &&
    compileErrorMessages.length > 0 &&
    (isCompileBadgeHovered || isCompilePanelPinned);

  const baseHeight = Number.parseFloat(workspaceHeight);
  const contentHeight =
    Number.isFinite(baseHeight) && baseHeight > 0
      ? `${Math.max(0, baseHeight - headerHeight)}px`
      : "100%";

  return (
    <Flex
      as="section"
      direction="column"
      flex="1"
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
        <Box ref={headerRef}>
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
          />
        </Box>
        <Box
          position="relative"
          flex="1"
          minH="0"
          display="flex"
          height={contentHeight}
          minHeight={contentHeight}
          overflow="hidden"
          bg="rgba(248,250,252,0.65)"
        >
          <SandpackLayout
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              display: activeView === "code" ? "flex" : "none",
            }}
          >
            <FileExplorerPanel token={token} />
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
                <MonacoSandpackEditor />
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
              <SandpackPreview style={{ width: "100%", height: "100%", overflow: "hidden" }} />
            </SandpackStack>
          </Box>
        </Box>
      </Flex>
    </Flex>
  );
};

export default WorkspaceShell;
