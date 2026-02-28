import { Badge, Flex, IconButton, Text } from "@chakra-ui/react";
import { CloseIcon } from "@components/common/Icon";

type SkillsStudioTopBarProps = {
  activeView: "preview" | "code";
  onChangeView: (view: "preview" | "code") => void;
  openedFiles: string[];
  activeFile: string;
  onSelectFileTab: (filePath: string) => void;
  onCloseFileTab: (filePath: string) => void;
  status: "idle" | "loading" | "ready" | "error";
  error: string;
};

const statusText: Record<SkillsStudioTopBarProps["status"], string> = {
  idle: "工作区：等待输入",
  loading: "工作区：初始化中",
  ready: "工作区：已就绪",
  error: "工作区：加载失败",
};

const viewButtonStyle = (active: boolean) => ({
  border: "1px solid",
  borderColor: active ? "rgba(56, 124, 255, 0.45)" : "#e2e8f0",
  background: active
    ? "linear-gradient(135deg, rgba(51,112,255,0.14) 0%, rgba(14,165,233,0.12) 100%)"
    : "rgba(255,255,255,0.92)",
  color: active ? "#1d4ed8" : "#1f2937",
  borderRadius: "999px",
  padding: "6px 12px",
  fontSize: "12px",
  fontWeight: 700,
});

const SkillsStudioTopBar = ({
  activeView,
  onChangeView,
  openedFiles,
  activeFile,
  onSelectFileTab,
  onCloseFileTab,
  status,
  error,
}: SkillsStudioTopBarProps) => {
  return (
    <Flex
      align="center"
      justify="space-between"
      px={4}
      py={2.5}
      borderBottom="1px solid"
      borderColor="myGray.200"
      bg="white"
      flexShrink={0}
      gap={3}
    >
      <Flex align="center" gap={2} minW={0} flex="1">
        <button style={viewButtonStyle(activeView === "preview")} type="button" onClick={() => onChangeView("preview")}>
          预览
        </button>
        <button style={viewButtonStyle(activeView === "code")} type="button" onClick={() => onChangeView("code")}>
          代码
        </button>
        <Flex w="1px" h="20px" bg="myGray.200" mx={1} />
        <Flex align="center" gap={2} minW={0} overflowX="auto" pl={1}>
          {openedFiles.map((path) => {
            const label = path.split("/").filter(Boolean).slice(-1)[0] || path;
            const isActive = path === activeFile;
            return (
              <Flex
                key={path}
                align="center"
                gap={1}
                px={2}
                h="36px"
                border="1px solid"
                borderColor={isActive ? "blue.200" : "myGray.200"}
                bg={isActive ? "blue.50" : "white"}
                color={isActive ? "blue.700" : "myGray.700"}
                borderRadius="12px"
                minW={0}
                maxW="220px"
              >
                <Text
                  fontSize="xs"
                  fontWeight={isActive ? "700" : "500"}
                  cursor="pointer"
                  isTruncated
                  onClick={() => onSelectFileTab(path)}
                >
                  {label}
                </Text>
                <IconButton
                  aria-label="关闭文件标签"
                  size="xs"
                  variant="ghost"
                  icon={<CloseIcon />}
                  onClick={() => onCloseFileTab(path)}
                />
              </Flex>
            );
          })}
        </Flex>
      </Flex>
      <Flex align="center" gap={2} flexShrink={0}>
        <Badge
          colorScheme={status === "error" ? "red" : status === "ready" ? "green" : "gray"}
          variant="subtle"
          borderRadius="md"
          px={2}
          py={1}
        >
          {statusText[status]}
        </Badge>
        {error ? (
          <Text color="red.500" fontSize="xs" maxW="180px" isTruncated title={error}>
            {error}
          </Text>
        ) : null}
      </Flex>
    </Flex>
  );
};

export default SkillsStudioTopBar;
