import { useEffect, useState } from "react";
import { Box, Flex, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { getConversation } from "@features/chat/services/conversations";
import { buildDownloadUrl } from "@features/chat/services/files";
import type { UploadedFileArtifact } from "@features/chat/types/fileArtifact";
import { ArtifactFileIcon } from "../workspace/ArtifactFileIcon";

type FloatingResourcesCardProps = {
  token: string;
  conversationId?: string;
  files: Record<string, { code: string }>;
  onSelectFile: (path: string) => void;
};

export default function FloatingResourcesCard({
  token,
  conversationId,
  files,
  onSelectFile,
}: FloatingResourcesCardProps) {
  const paths = Object.keys(files).sort();
  const [sources, setSources] = useState<UploadedFileArtifact[]>([]);

  useEffect(() => {
    if (!token || !conversationId) {
      setSources([]);
      return;
    }
    let active = true;
    void getConversation(token, conversationId)
      .then((conversation) => {
        if (!active) return;
        const attachments = new Map<string, UploadedFileArtifact>();
        for (const message of conversation?.messages ?? []) {
          if (message.role !== "user" || !message.artifact || typeof message.artifact !== "object") {
            continue;
          }
          const msgFiles = (message.artifact as { files?: UploadedFileArtifact[] }).files;
          if (!Array.isArray(msgFiles)) continue;
          for (const file of msgFiles) {
            if (file?.storagePath && file.name) attachments.set(file.storagePath, file);
          }
        }
        setSources([...attachments.values()]);
      })
      .catch(() => {
        if (active) setSources([]);
      });
    return () => {
      active = false;
    };
  }, [token, conversationId]);

  return (
    <Box
      position="absolute"
      top={2}
      right={4}
      w="256px"
      maxH="calc(100dvh - 100px)"
      overflowY="auto"
      bg="white"
      borderRadius="18px"
      border="1px solid"
      borderColor="stroke.subtle"
      boxShadow="0 8px 28px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.03)"
      p={4}
      zIndex={10}
    >
      <VStack align="stretch" spacing={4}>
        {/* 输出 */}
        <Box>
          <HStack justify="space-between" mb={2}>
            <Text fontSize="13px" fontWeight="500" color="ink.secondary">
              输出
            </Text>
            <IconButton
              aria-label="展开输出列表"
              icon={<Plus size={14} color="#8f8f8f" />}
              size="xs"
              variant="ghost"
              h="22px"
              minW="22px"
              onClick={() => {
                if (paths[0]) onSelectFile(paths[0]);
              }}
            />
          </HStack>

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
              创建输出内容
            </Text>
          )}
        </Box>

        {/* 来源 */}
        <Box>
          <HStack justify="space-between" mb={2}>
            <Text fontSize="13px" fontWeight="500" color="ink.secondary">
              来源
            </Text>
            <Plus size={14} color="#8f8f8f" />
          </HStack>

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
              附加文件或连接应用
            </Text>
          )}
        </Box>
      </VStack>
    </Box>
  );
}
