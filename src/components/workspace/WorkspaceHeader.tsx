import { Badge, Flex, Text } from "@chakra-ui/react";

type WorkspaceHeaderProps = {
  activeView: "preview" | "code";
  onChangeView: (view: "preview" | "code") => void;
  status: "idle" | "loading" | "ready" | "error";
  error: string;
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

const WorkspaceHeader = ({ activeView, onChangeView, status, error }: WorkspaceHeaderProps) => {
  return (
    <Flex
      align="center"
      gap={2}
      wrap="wrap"
      borderBottom="1px solid"
      borderColor="rgba(226,232,240,0.9)"
      px={4}
      py={2.5}
      bg="linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(248,250,252,0.75) 100%)"
      flexShrink={0}
    >
      <Flex gap={2} align="center">
        <button style={viewButtonStyle(activeView === "preview")} type="button" onClick={() => onChangeView("preview")}>
          预览
        </button>
        <button style={viewButtonStyle(activeView === "code")} type="button" onClick={() => onChangeView("code")}>
          代码
        </button>
      </Flex>
      <Flex align="center" gap={2} flexWrap="wrap" marginLeft="auto">
        <Badge colorScheme={status === "error" ? "red" : status === "ready" ? "green" : "gray"} variant="subtle">
          {status === "idle" && "等待输入"}
          {status === "loading" && "正在加载"}
          {status === "ready" && "已就绪"}
          {status === "error" && "加载失败"}
        </Badge>
        {error ? (
          <Text fontSize="xs" color="red.500">
            {error}
          </Text>
        ) : null}
      </Flex>
    </Flex>
  );
};

export default WorkspaceHeader;
