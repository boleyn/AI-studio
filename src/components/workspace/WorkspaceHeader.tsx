import { Badge, Box, Flex, Text, useTheme } from "@chakra-ui/react";

type WorkspaceHeaderProps = {
  activeView: "preview" | "code";
  onChangeView: (view: "preview" | "code") => void;
  status: "idle" | "loading" | "ready" | "error";
  error: string;
  compileStatus: "ready" | "compiling" | "error";
  compileErrorCount: number;
  onCompileBadgeHoverChange: (hovering: boolean) => void;
  onCompileBadgeToggle: () => void;
  tabs: string[];
  activeFile: string;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  hideStatusBadge?: boolean;
  customStatusBadge?: {
    text: string;
    colorScheme: string;
    title?: string;
    clickable?: boolean;
    onClick?: () => void;
  };
};

const WorkspaceHeader = ({
  activeView,
  onChangeView,
  status,
  error,
  compileStatus,
  compileErrorCount,
  onCompileBadgeHoverChange,
  onCompileBadgeToggle,
  tabs,
  activeFile,
  onSelectTab,
  onCloseTab,
  hideStatusBadge = false,
  customStatusBadge,
}: WorkspaceHeaderProps) => {
  const theme = useTheme() as Record<string, any>;
  const headerTheme = theme.workspace?.header ?? {
    container: {
      borderColor: "var(--ws-border)",
      bg: "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(248,251,255,0.82) 100%)",
    },
    divider: {
      bg: "myGray.300",
    },
    viewButton: {
      borderColor: "var(--ws-border)",
      activeBorderColor: "var(--ws-accent-border)",
      bg: "var(--ws-surface-strong)",
      activeBg: "var(--ws-tab-active-bg)",
      color: "var(--ws-text-subtle)",
      activeColor: "var(--ws-accent)",
      fontSize: "xs",
      fontWeight: "700",
      px: "12px",
      py: "6px",
      radius: "999px",
    },
    error: {
      color: "red.500",
      fontSize: "xs",
    },
  };

  const hasCompileErrors = status === "ready" && compileStatus === "error" && compileErrorCount > 0;

  const badgeColorScheme =
    status === "error"
      ? "red"
      : status !== "ready"
      ? "gray"
      : compileStatus === "error"
      ? "red"
      : compileStatus === "compiling"
      ? "orange"
      : "green";

  const badgeText =
    status === "idle"
      ? "等待输入"
      : status === "loading"
      ? "正在加载"
      : status === "error"
      ? "加载失败"
      : compileStatus === "error"
      ? `编译报错 ${compileErrorCount} 个`
      : compileStatus === "compiling"
      ? "编译中"
      : "已就绪";
  const visibleTabs = tabs.filter((filePath) => Boolean(filePath && filePath.trim()));
  const headerMinH = "62px";
  const tabSlotMinH = "40px";

  return (
    <Flex
      align="center"
      gap={2.5}
      borderBottom="1px solid"
      borderColor={headerTheme.container.borderColor}
      px={4}
      py={2}
      minH={headerMinH}
      boxSizing="border-box"
      bg={headerTheme.container.bg}
      backdropFilter="blur(14px)"
      flexShrink={0}
    >
      <Flex gap={2} align="center">
        <Box
          as="button"
          border="1px solid"
          borderColor={activeView === "preview" ? headerTheme.viewButton.activeBorderColor : headerTheme.viewButton.borderColor}
          bg={activeView === "preview" ? headerTheme.viewButton.activeBg : headerTheme.viewButton.bg}
          color={activeView === "preview" ? headerTheme.viewButton.activeColor : headerTheme.viewButton.color}
          borderRadius={headerTheme.viewButton.radius}
          px={headerTheme.viewButton.px}
          py={headerTheme.viewButton.py}
          fontSize={headerTheme.viewButton.fontSize}
          fontWeight={headerTheme.viewButton.fontWeight}
          lineHeight="1"
          type="button"
          onClick={() => onChangeView("preview")}
        >
          预览
        </Box>
        <Box
          as="button"
          border="1px solid"
          borderColor={activeView === "code" ? headerTheme.viewButton.activeBorderColor : headerTheme.viewButton.borderColor}
          bg={activeView === "code" ? headerTheme.viewButton.activeBg : headerTheme.viewButton.bg}
          color={activeView === "code" ? headerTheme.viewButton.activeColor : headerTheme.viewButton.color}
          borderRadius={headerTheme.viewButton.radius}
          px={headerTheme.viewButton.px}
          py={headerTheme.viewButton.py}
          fontSize={headerTheme.viewButton.fontSize}
          fontWeight={headerTheme.viewButton.fontWeight}
          lineHeight="1"
          type="button"
          onClick={() => onChangeView("code")}
        >
          代码
        </Box>
      </Flex>
      <Flex
        aria-hidden="true"
        width="1px"
        height="28px"
        bg={headerTheme.divider.bg}
        borderRadius="full"
        mx={1}
      />
      <Flex flex="1" minW="0" align="stretch" display={activeView === "code" ? "flex" : "none"}>
        {visibleTabs.length > 0 ? (
          <Flex
            flex="1"
            minW="0"
            minH={tabSlotMinH}
            align="center"
            gap={2}
            overflowX="auto"
            py={1}
            px={0.5}
          >
            {visibleTabs.map((filePath) => {
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
                  onClick={() => onSelectTab(filePath)}
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
                    onCloseTab(filePath);
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
        ) : (
          <Box flex="1" minW="0" minH={tabSlotMinH} />
        )}
      </Flex>
      <Flex align="center" gap={2} flexWrap="wrap" marginLeft="auto">
        {!hideStatusBadge ? (
          <Badge
            colorScheme={badgeColorScheme}
            variant="subtle"
            cursor={hasCompileErrors ? "pointer" : "default"}
            userSelect="none"
            title={hasCompileErrors ? "悬停可展开下方编译错误" : undefined}
            onMouseEnter={() => onCompileBadgeHoverChange(true)}
            onMouseLeave={() => onCompileBadgeHoverChange(false)}
            onClick={() => {
              if (!hasCompileErrors) return;
              onCompileBadgeToggle();
            }}
          >
            {badgeText}
          </Badge>
        ) : null}
        {customStatusBadge ? (
          <Badge
            colorScheme={customStatusBadge.colorScheme}
            variant="subtle"
            cursor={customStatusBadge.clickable ? "pointer" : "default"}
            userSelect="none"
            title={customStatusBadge.title}
            onClick={() => {
              if (!customStatusBadge.clickable) return;
              customStatusBadge.onClick?.();
            }}
          >
            {customStatusBadge.text}
          </Badge>
        ) : null}
        {error ? (
          <Text fontSize={headerTheme.error.fontSize} color={headerTheme.error.color}>
            {error}
          </Text>
        ) : null}
      </Flex>
    </Flex>
  );
};

export default WorkspaceHeader;
