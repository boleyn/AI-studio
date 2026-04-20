import { Box } from "@chakra-ui/react";

export type TimelineStatus = "running" | "completed" | "error" | "denied";

const statusTextMap: Record<TimelineStatus, string> = {
  running: "执行中",
  completed: "完成",
  error: "失败",
  denied: "已拒绝",
};

const statusToneMap: Record<
  TimelineStatus,
  { color: string; bg: string; border: string }
> = {
  running: { color: "blue.700", bg: "blue.50", border: "blue.200" },
  completed: { color: "green.700", bg: "green.50", border: "green.200" },
  error: { color: "red.700", bg: "red.50", border: "red.200" },
  denied: { color: "orange.700", bg: "orange.50", border: "orange.200" },
};

const TimelineStatusPill = ({ status }: { status: TimelineStatus }) => {
  const tone = statusToneMap[status];
  return (
    <Box
      as="span"
      border="1px solid"
      borderColor={tone.border}
      borderRadius="999px"
      bg={tone.bg}
      color={tone.color}
      fontSize="10px"
      px={2}
      py="1px"
    >
      {statusTextMap[status]}
    </Box>
  );
};

export default TimelineStatusPill;
