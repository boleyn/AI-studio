import { Flex, Text } from "@chakra-ui/react";

interface MessageNodeStatusProps {
  durationSeconds?: number;
  nodeCount: number;
}

const MessageNodeStatus = ({ durationSeconds, nodeCount }: MessageNodeStatusProps) => {
  return (
    <Flex align="center" color="gray.500" fontSize="11px" gap={2} mb={1.5} px={1}>
      <Flex align="center" gap={1}>
        <Flex bg="green.400" borderRadius="full" h="6px" w="6px" />
        <Text>节点 {nodeCount}</Text>
      </Flex>
      {durationSeconds !== undefined ? <Text>耗时 {durationSeconds.toFixed(2)}s</Text> : null}
    </Flex>
  );
};

export default MessageNodeStatus;
