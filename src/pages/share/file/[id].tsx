import { recordLibraryOpen } from "@features/chat/services/libraryAttachment";
import { markdownFilename } from "@/types/library";
import { Box, Button, Flex, IconButton, Spinner, Text, useToast } from "@chakra-ui/react";
import { ArrowLeft, CircleAlert, Download } from "lucide-react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { downloadAuthenticatedFile, redirectedToLogin } from "@features/chat/services/files";
import { withAuthHeaders } from "@features/auth/client/authClient";
import LibraryItemIcon from "@/components/agent-workspace/LibraryItemIcon";
import { PreviewZoomMenu } from "@/components/workspace/PreviewZoomMenu";
import FilePreviewPanel, { isSpreadsheetFile } from "@/components/workspace/FilePreviewPanel";
import ExtendedFilePreview from "@/components/workspace/ExtendedFilePreview";

import LibraryPageEditor, { mobilePageReaderQuery, type PageDraft } from "@/components/agent-workspace/LibraryPageEditor";

export default function SharedArtifactPage() {
  const { query } = useRouter();
  const id = typeof query.id === "string" ? query.id : "";
  const drafts = useRef(new Map<string,PageDraft>());
  return <SharedFilePreview key={id} id={id} drafts={drafts.current}/>;
}

function SharedFilePreview({id,drafts}:{id:string;drafts:Map<string,PageDraft>}) {
  const toast = useToast();
  const [downloading,setDownloading] = useState(false);
  const endpoint = `/api/artifact-share?${new URLSearchParams({ id })}`;
  const [result, setResult] = useState<{ id: string; received?: boolean; viewerLibraryId?: string; filename?: string; previewName?: string; livePage?: boolean; editablePageId?: string; error?: string; needsLogin?: boolean }>();
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
        if (response.status === 401 || redirectedToLogin(response)) {
          if (!controller.signal.aborted) {
            setResult({ id, needsLogin: true, error: "请登录受邀账号后查看文件。" });
          }
          return;
        }
        if (!response.ok) throw new Error(response.status === 403 ? "当前账号没有访问权限。" :
          response.status === 404 ? "共享文件不存在或共享已结束。" : "暂时无法读取共享文件，请稍后重试。");
        const data = await response.json() as { filename: string; viewerLibraryId?: string; previewName?: string; livePage?: boolean; editablePageId?: string };
        if (!data || typeof data.filename !== "string" || !data.filename.trim()) {
          throw new Error("共享文件信息不完整，请重新加载。");
        }
        if (controller.signal.aborted) return;
        setResult({ id, viewerLibraryId:data.viewerLibraryId, received:data.viewerLibraryId === id, filename: data.filename, previewName:data.previewName, livePage:data.livePage, editablePageId:data.editablePageId });
        if (data.viewerLibraryId) recordLibraryOpen(data.viewerLibraryId);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setResult({ id, error: reason instanceof TypeError ? "连接失败，请检查网络后重试。" : reason instanceof SyntaxError ? "共享文件信息无法读取，请重新加载。" : reason.message || "共享文件不可用。" });
      });
    return () => controller.abort();
  }, [id, endpoint, loadAttempt]);

  const backLabel = current?.received ? "返回「与你共享」" : "返回资料空间";
  const libraryLink = <IconButton as="a" href={current?.received ? "/?" + new URLSearchParams({view:"library",libraryTab:"与你共享"}) : "/?view=library"}
    aria-label={backLabel} title={backLabel}
    icon={<ArrowLeft size={18}/>} size="sm" variant="ghost" borderRadius="full" flexShrink={0}/>;

  if (!current?.filename) {
    const loginUrl = `/login?${new URLSearchParams({ lastRoute: `/share/file/${encodeURIComponent(id)}` })}`;
    return <Flex h="100dvh" direction="column" gap={4} align="center" justify="center" px={4}>
      {current?.error ? <Flex direction="column" align="center" gap={3} maxW="26rem" textAlign="center">
        <CircleAlert size={24} color="#777" aria-hidden/>
        <Box role="alert">
          <Text as="h1" fontWeight="600">无法打开共享文件</Text>
          <Text mt={1} fontSize="sm" color="gray.600" overflowWrap="anywhere">{current.error}</Text>
        </Box>
        <Flex gap={2} wrap="wrap" justify="center">
          {current.needsLogin ? <Button as="a" href={loginUrl} size="sm" borderRadius="full">登录</Button> :
            <Button size="sm" variant="outline" borderRadius="full" onClick={()=>{
              setResult(undefined);
              setLoadAttempt(value=>value+1);
            }}>重新加载</Button>}
          <Button as="a" href="/?view=library" size="sm" variant="ghost" borderRadius="full">返回资料空间</Button>
        </Flex>
      </Flex> : <Spinner aria-label="正在读取共享文件"/>}
    </Flex>;
  }

  const url = `${endpoint}&file=1`;
  const previewName = current.previewName || current.filename;
  const isSpreadsheet = isSpreadsheetFile(previewName);
  const retry = () => setAttempt((value) => value + 1);
  if (editing && current.editablePageId) return <LibraryPageEditor drafts={drafts} key={id} page={{id:current.editablePageId}} shareId={id} backLabel="返回预览"
    onBack={()=>{setEditing(false);retry();}} onSaved={name=>setResult({...current,filename:markdownFilename(name),previewName:markdownFilename(name)})}/>;
  return <Flex h="100dvh" direction="column" bg="white">
    <Flex px={4} py={3} gap={3} align="center" borderBottom="1px solid" borderColor="gray.100">
      {libraryLink}
      <LibraryItemIcon item={{name:previewName,sharedPage:current.livePage}} compact />
      <Text isTruncated flex={1} fontSize="sm" fontWeight="semibold">{current.filename}</Text>
      {current.viewerLibraryId && <Button as="a" size="sm" variant="ghost" href={"/?" + new URLSearchParams({
        view:"library", libraryItem:current.viewerLibraryId, ...(current.received ? {libraryTab:"与你共享"} : {})
      })}>在资料空间打开</Button>}
      {current.editablePageId && <Button size="sm" sx={{[`@media ${mobilePageReaderQuery}`]:{display:"none"}}} onClick={()=>setEditing(true)}>编辑页面</Button>}
      {isSpreadsheet && <PreviewZoomMenu label="表格缩放" zoom={spreadsheetZoom} onChange={setSpreadsheetZoom} />}
      <Button leftIcon={<Download size={16} />} size="sm" variant="ghost" isLoading={downloading} onClick={async ()=>{
        setDownloading(true);
        try {
          await downloadAuthenticatedFile(url, previewName, true);
        } catch (error) {
          toast({status:"error",title:"下载失败",description:error instanceof TypeError ? "连接失败，请检查网络后重试。" : error instanceof Error ? error.message : "请稍后重试。"});
        } finally {
          setDownloading(false);
        }
      }}>下载</Button>
    </Flex>
    <Box flex={1} minH={0}>
      {isSpreadsheet ? (
        <FilePreviewPanel key={`${id}:${attempt}`} binaryUrl={url} activeFile={previewName} token="" sourceCode=""
          localOnly onRetry={retry} spreadsheetZoom={spreadsheetZoom} />
      ) : (
        <ExtendedFilePreview key={`${id}:${attempt}`} url={url} name={previewName} interactivePages={current.livePage} onRetry={retry} />
      )}
    </Box>
  </Flex>;
}
