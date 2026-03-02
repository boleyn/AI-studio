import { Badge, Box, Flex, Text, useTheme } from "@chakra-ui/react";
import { FileTabs } from "@codesandbox/sandpack-react";

type WorkspaceHeaderProps = {
  activeView: "preview" | "code";
  onChangeView: (view: "preview" | "code") => void;
  status: "idle" | "loading" | "ready" | "error";
  error: string;
  compileStatus: "ready" | "compiling" | "error";
  compileErrorCount: number;
  onCompileBadgeHoverChange: (hovering: boolean) => void;
  onCompileBadgeToggle: () => void;
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
}: WorkspaceHeaderProps) => {
  const theme = useTheme() as Record<string, any>;
  const headerTheme = theme.workspace?.header ?? {
    container: {
      borderColor: "myGray.200",
      bg: "linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(248,250,252,0.75) 100%)",
    },
    divider: {
      bg: "myGray.300",
    },
    viewButton: {
      borderColor: "myGray.200",
      activeBorderColor: "blue.300",
      bg: "rgba(255,255,255,0.92)",
      activeBg: "linear-gradient(135deg, rgba(51,112,255,0.14) 0%, rgba(14,165,233,0.12) 100%)",
      color: "myGray.800",
      activeColor: "blue.700",
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

  return (
    <Flex
      align="center"
      gap={2}
      borderBottom="1px solid"
      borderColor={headerTheme.container.borderColor}
      px={4}
      py={1.5}
      bg={headerTheme.container.bg}
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
        <FileTabs closableTabs={false} />
      </Flex>
      <Flex align="center" gap={2} flexWrap="wrap" marginLeft="auto">
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
