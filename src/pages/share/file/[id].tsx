import { Box, Button, Flex, Spinner, Text } from "@chakra-ui/react";
import { Download } from "lucide-react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import LibraryItemIcon from "@/components/agent-workspace/LibraryItemIcon";
import { PreviewZoomMenu } from "@/components/workspace/PreviewZoomMenu";
import FilePreviewPanel, { isSpreadsheetFile } from "@/components/workspace/FilePreviewPanel";
import ExtendedFilePreview from "@/components/workspace/ExtendedFilePreview";

import LibraryPageEditor, { mobilePageReaderQuery } from "@/components/agent-workspace/LibraryPageEditor";

export default function SharedArtifactPage() {
  const { query } = useRouter();
  const id = typeof query.id === "string" ? query.id : "";
  const endpoint = `/api/artifact-share?${new URLSearchParams({ id })}`;
  const [result, setResult] = useState<{ id: string; filename?: string; editablePageId?: string; error?: string; needsLogin?: boolean }>();
  const [loadAttempt,setLoadAttempt] = useState(0);
  const [editing,setEditing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [spreadsheetZoom, setSpreadsheetZoom] = useState(100);
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
        if (!response.ok) throw new Error(response.status === 403 ? "当前账号没有访问权限。" :
          response.status === 404 ? "共享文件不存在或共享已结束。" : "暂时无法读取共享文件，请稍后重试。");
        const data = await response.json() as { filename: string; editablePageId?: string };
        if (!controller.signal.aborted) setResult({ id, filename: data.filename, editablePageId:data.editablePageId });
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setResult({ id, error: reason instanceof TypeError ? "连接失败，请检查网络后重试。" : reason.message || "共享文件不可用。" });
      });
    return () => controller.abort();
  }, [id, endpoint, loadAttempt]);

  if (!current?.filename) {
    const loginUrl = `/login?${new URLSearchParams({ lastRoute: `/share/file/${encodeURIComponent(id)}` })}`;
    return <Flex h="100dvh" direction="column" gap={4} align="center" justify="center" px={4}>
      {current?.error ? <Text role="status">{current.error}</Text> : <Spinner aria-label="正在读取共享文件" />}
      {current?.error && !current.needsLogin && <Button size="sm" variant="outline" borderRadius="full" onClick={()=>{
        setResult(undefined);
        setLoadAttempt(value=>value+1);
      }}>重新加载</Button>}
      {current?.needsLogin && <Button as="a" href={loginUrl} size="sm">登录</Button>}
    </Flex>;
  }

  const url = `${endpoint}&file=1`;
  const isSpreadsheet = isSpreadsheetFile(current.filename);
  const retry = () => setAttempt((value) => value + 1);
  if (editing && current.editablePageId) return <LibraryPageEditor key={id} page={{id:current.editablePageId}} shareId={id} backLabel="返回预览"
    onBack={()=>{setEditing(false);retry();}} onSaved={name=>setResult({...current,filename:name+".md"})}/>;
  return <Flex h="100dvh" direction="column" bg="white">
    <Flex px={4} py={3} gap={3} align="center" borderBottom="1px solid" borderColor="gray.100">
      <LibraryItemIcon item={{name:current.filename}} compact />
      <Text isTruncated flex={1} fontSize="sm" fontWeight="semibold">{current.filename}</Text>
      {current.editablePageId && <Button size="sm" sx={{[`@media ${mobilePageReaderQuery}`]:{display:"none"}}} onClick={()=>setEditing(true)}>编辑页面</Button>}
      {isSpreadsheet && <PreviewZoomMenu label="表格缩放" zoom={spreadsheetZoom} onChange={setSpreadsheetZoom} />}
      <Button as="a" href={url} download={current.filename} leftIcon={<Download size={16} />} size="sm" variant="ghost">下载</Button>
    </Flex>
    <Box flex={1} minH={0}>
      {isSpreadsheet ? (
        <FilePreviewPanel key={`${id}:${attempt}`} binaryUrl={url} activeFile={current.filename} token="" sourceCode=""
          localOnly onRetry={retry} spreadsheetZoom={spreadsheetZoom} />
      ) : (
        <ExtendedFilePreview key={`${id}:${attempt}`} url={url} name={current.filename} onRetry={retry} />
      )}
    </Box>
  </Flex>;
}
