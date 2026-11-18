import { Box, Flex, Text, VStack } from "@chakra-ui/react";
import { Bot } from "lucide-react";
import { buildDownloadUrl } from "@features/chat/services/files";
import type { ConversationResources } from "@features/chat/components/ChatPanel";
import { ArtifactFileIcon } from "../workspace/ArtifactFileIcon";

const agentStatus = {
  pending: "等待中",
  in_progress: "运行中",
  completed: "已完成",
  error: "失败",
  interrupted: "已中断",
};

type FloatingResourcesCardProps = {
  token: string;
  conversationId?: string;
  files: Record<string, { code: string }>;
  resources?: ConversationResources;
  onSelectFile: (path: string) => void;
};

export default function FloatingResourcesCard({
  token,
  conversationId,
  files,
  resources,
  onSelectFile,
}: FloatingResourcesCardProps) {
  const paths = Object.keys(files).sort();
  const sources = resources?.files ?? [];
  const agents = resources?.agents ?? [];

  return (
    <Box maxH="calc(100dvh - 100px)" overflowY="auto" p={4}>
      <VStack align="stretch" spacing={4}>
        {/* 输出 */}
        <Box>
          <Text fontSize="sm" color="ink.secondary" mb={2}>
            输出
          </Text>

          {paths.length > 0 ? (
            <VStack align="stretch" spacing={1}>
              {paths.map((filePath) => {
                const name = filePath.split("/").pop() || filePath;
                return (
                  <Flex
                    key={filePath}
                    as="button"
                    type="button"
                    align="center"
                    gap={2.5}
                    px={2}
                    py={1.5}
                    borderRadius="10px"
                    textAlign="left"
                    w="full"
                    _hover={{ bg: "surface.hover" }}
                    onClick={() => onSelectFile(filePath)}
                  >
                    <Box flexShrink={0}>
                      <ArtifactFileIcon name={name} />
                    </Box>
                    <Text fontSize="13px" color="ink.primary" noOfLines={1}>
                      {name}
                    </Text>
                  </Flex>
                );
              })}
            </VStack>
          ) : (
            <Text fontSize="13px" color="ink.muted" px={0.5}>
              暂无输出
            </Text>
          )}
        </Box>

        {/* 来源 */}
        <Box>
          <Text fontSize="sm" color="ink.secondary" mb={2}>
            来源
          </Text>

          {sources.length > 0 && conversationId ? (
            <VStack align="stretch" spacing={1}>
              {sources.map((file) => (
                <Flex
                  key={file.storagePath}
                  as="a"
                  href={buildDownloadUrl({
                    storagePath: file.storagePath!,
                    token,
                    chatId: conversationId,
                  })}
                  align="center"
                  gap={2.5}
                  px={2}
                  py={1.5}
                  borderRadius="10px"
                  _hover={{ bg: "surface.hover" }}
                >
                  <Box flexShrink={0}>
                    <ArtifactFileIcon name={file.name} />
                  </Box>
                  <Text fontSize="13px" color="ink.primary" noOfLines={1}>
                    {file.name}
                  </Text>
                </Flex>
              ))}
            </VStack>
          ) : (
            <Text fontSize="13px" color="ink.muted" px={0.5}>
              暂无来源
            </Text>
          )}
        </Box>
        <Box borderTopWidth="1px" borderColor="stroke.subtle" pt={3}>
          <Text fontSize="sm" color="ink.secondary" mb={2}>
            子智能体
          </Text>
          {agents.length ? (
            <VStack
              as="ul"
              align="stretch"
              listStyleType="none"
              spacing={2}
              m={0}
            >
              {agents.map((agent) => (
                <Flex
                  as="li"
                  key={agent.id}
                  align="center"
                  gap={2}
                  fontSize="xs"
                >
                  <Box
                    color={
                      agent.status === "completed"
                        ? "green.600"
                        : "ink.secondary"
                    }
                    flexShrink={0}
                    aria-hidden="true"
                  >
                    <Bot size={15} />
                  </Box>
                  <Text flex="1" noOfLines={1} title={agent.label}>
                    {agent.label}
                  </Text>
                  <Text color="ink.secondary" flexShrink={0}>
                    {agentStatus[agent.status]}
                  </Text>
                </Flex>
              ))}
            </VStack>
          ) : (
            <Text fontSize="xs" color="ink.secondary">
              暂无子智能体
            </Text>
          )}
        </Box>
      </VStack>
    </Box>
  );
}
