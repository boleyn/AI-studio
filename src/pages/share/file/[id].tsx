import { Box, Button, Flex, Spinner, Text } from "@chakra-ui/react";
import { Download } from "lucide-react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { ArtifactFileIcon } from "@/components/workspace/ArtifactFileIcon";
import ExtendedFilePreview from "@/components/workspace/ExtendedFilePreview";

export default function SharedArtifactPage() {
  const { query } = useRouter();
  const id = typeof query.id === "string" ? query.id : "";
  const endpoint = `/api/artifact-share?${new URLSearchParams({ id })}`;
  const [result, setResult] = useState<{ id: string; filename?: string; error?: string; needsLogin?: boolean }>();
  const [attempt, setAttempt] = useState(0);
  const current = result?.id === id ? result : undefined;

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void fetch(endpoint, { headers: withAuthHeaders(), signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          if (!controller.signal.aborted) {
            setResult({ id, needsLogin: true, error: "登录 Hermes 后即可查看受邀文件。" });
          }
          return;
        }
        if (!response.ok) throw new Error("共享文件不可用或未向你开放。");
        const data = await response.json() as { filename: string };
        if (!controller.signal.aborted) setResult({ id, filename: data.filename });
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setResult({ id, error: reason.message || "共享文件不可用。" });
      });
    return () => controller.abort();
  }, [id, endpoint]);

  if (!current?.filename) {
    const loginUrl = `/login?${new URLSearchParams({ lastRoute: `/share/file/${encodeURIComponent(id)}` })}`;
    return <Flex h="100dvh" direction="column" gap={4} align="center" justify="center" px={4}>
      {current?.error ? <Text role="status">{current.error}</Text> : <Spinner aria-label="正在读取共享文件" />}
      {current?.needsLogin && <Button as="a" href={loginUrl} size="sm">登录</Button>}
    </Flex>;
  }

  const url = `${endpoint}&file=1`;
  return <Flex h="100dvh" direction="column" bg="white">
    <Flex px={4} py={3} gap={3} align="center" borderBottom="1px solid" borderColor="gray.100">
      <ArtifactFileIcon name={current.filename} compact />
      <Text isTruncated flex={1} fontSize="sm" fontWeight="semibold">{current.filename}</Text>
      <Button as="a" href={url} download={current.filename} leftIcon={<Download size={16} />} size="sm" variant="ghost">下载</Button>
    </Flex>
    <Box flex={1} minH={0}>
      <ExtendedFilePreview key={`${id}:${attempt}`} url={url} name={current.filename} onRetry={() => setAttempt((value) => value + 1)} />
    </Box>
  </Flex>;
}
