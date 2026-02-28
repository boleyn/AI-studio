import {
  SandpackCodeEditor,
  SandpackConsole,
  SandpackLayout,
  SandpackPreview,
  SandpackStack,
} from "@codesandbox/sandpack-react";
import { Box, Flex } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";

import FileExplorerPanel from "./workspace/FileExplorerPanel";
import WorkspaceHeader from "./workspace/WorkspaceHeader";

type ActiveView = "preview" | "code";

type WorkspaceShellProps = {
  status: "idle" | "loading" | "ready" | "error";
  error: string;
  activeView: ActiveView;
  onChangeView: (view: ActiveView) => void;
  workspaceHeight: string;
};

const WorkspaceShell = ({
  status,
  error,
  activeView,
  onChangeView,
  workspaceHeight,
}: WorkspaceShellProps) => {
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

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
            <FileExplorerPanel />
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
                <SandpackCodeEditor
                  showTabs
                  showLineNumbers
                  wrapContent
                  style={{ flex: 1, minHeight: 0 }}
                />
                <SandpackConsole
                  style={{
                    maxHeight: "35%",
                    overflow: "auto",
                    borderTop: "1px solid rgba(203,213,225,0.85)",
                  }}
                />
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
