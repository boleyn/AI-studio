import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArtifactSection } from "../workspace/ArtifactSection";
import ArtifactShareDialog from "../workspace/ArtifactShareDialog";
import { ArtifactFileIcon, artifactFileType } from "../workspace/ArtifactFileIcon";
import { PreviewZoomMenu } from "../workspace/PreviewZoomMenu";
import type { FileViewerHandle, FileViewerProps } from "@file-viewer/react-full";
import ExtendedFilePreview from "../workspace/ExtendedFilePreview";
import FilePreviewPanel, { isSpreadsheetFile } from "../workspace/FilePreviewPanel";
import { Accordion, Box, Button, Flex, IconButton, Menu, MenuButton, MenuItem, MenuList, Text, useToast } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { getConversation } from "@features/chat/services/conversations";
import type { UploadedFileArtifact } from "@features/chat/types/fileArtifact";
import { buildDownloadUrl, downloadWorkspaceArtifact } from "@features/chat/services/files";
import { ArrowLeft, ChevronDown, ChevronRight, Download, History, Maximize2, Minimize2, Share2, X } from "lucide-react";

type Props = {
  token: string;
  version?: string;
  conversationId?: string;
  onSelectVersion: (version?: string) => void;
  files: Record<string, { code: string }>;
  selectedPath: string;
  onSelect: (path: string) => void;
  onShowList: () => void;
  onRequestRevision: (text: string) => void;
  onClose: () => void;
};

export default function WorkspaceFilesPanel({ token, version, conversationId, onSelectVersion, files, selectedPath, onSelect, onShowList, onRequestRevision, onClose }: Props) {
  const versionScope = JSON.stringify([token, selectedPath]);
  const [versionResult, setVersionResult] = useState<{
    scope: string;
    items?: { id: string; time?: string | Date }[];
  }>();
  const scopedVersionResult = versionResult?.scope === versionScope ? versionResult : undefined;
  const versionList = scopedVersionResult?.items;
  const versionError = Boolean(scopedVersionResult && !versionList);
  const selectedVersionIndex = versionList?.findIndex((entry) => entry.id === version) ?? -1;
  const selectedVersionLabel = versionList && selectedVersionIndex >= 0
    ? `版本 ${versionList.length - selectedVersionIndex}`
    : "历史版本";
  const versionRequest = useRef(0);
  const [sharingFile, setSharingFile] = useState<string>();
  const [revisionTarget, setRevisionTarget] = useState<string>();
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const retryPreview = () => {
    setHistoricalResult(undefined);
    setPreviewAttempt((attempt) => attempt + 1);
  };
  const viewerHandle = useRef<FileViewerHandle | null>(null);
  const setViewerHandle = useCallback((viewer: FileViewerHandle | null) => { viewerHandle.current = viewer; }, []);
  const [documentZoom, setDocumentZoom] = useState<{ url: string; percent: number }>();
  const [spreadsheetZoom, setSpreadsheetZoom] = useState(100);
  const [expanded, setExpanded] = useState(false);
  const [paneWidth, setPaneWidth] = useState(58);
  const panelRef = useRef<HTMLElement>(null);
  const resizePane = (width: number) => setPaneWidth(Math.max(35, Math.min(75, width)));
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const listButtons = useRef(new Map<string, HTMLButtonElement>());
  const listFocusPath = useRef<string>();
  useEffect(() => {
    if (selectedPath) {
      if (listFocusPath.current === selectedPath) backButtonRef.current?.focus();
      return;
    }
    const path = listFocusPath.current;
    if (path) listButtons.current.get(path)?.focus();
    listFocusPath.current = undefined;
  }, [selectedPath]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const paths = Object.keys(files).sort();
  const [sources, setSources] = useState<UploadedFileArtifact[]>([]);
  useEffect(() => {
    if (selectedPath || !conversationId) return;
    let active = true;
    void getConversation(token, conversationId).then((conversation) => {
      if (!active) return;
      const attachments = new Map<string, UploadedFileArtifact>();
      for (const message of conversation?.messages ?? []) {
        if (message.role !== "user" || !message.artifact || typeof message.artifact !== "object") continue;
        const files = (message.artifact as { files?: UploadedFileArtifact[] }).files;
        if (!Array.isArray(files)) continue;
        for (const file of files) {
          if (file?.storagePath && file.name) attachments.set(file.storagePath, file);
        }
      }
      setSources([...attachments.values()]);
    });
    return () => { active = false; };
  }, [token, conversationId, selectedPath]);
  const [historicalResult, setHistoricalResult] = useState<
    { url: string; content: string } | { url: string; error: true }
  >();
  const query = new URLSearchParams({ token, action: "view", path: selectedPath });
  if (version) query.set("version", version);
  const fileUrl = `/api/code?${query}`;
  const isSpreadsheet = isSpreadsheetFile(selectedPath);
  const showDocumentZoom = /\.docx$/i.test(selectedPath);
  const onDocumentStateChange = useCallback<NonNullable<FileViewerProps["onStateChange"]>>((state) => {
    const percent = state.zoom ? Math.round(state.zoom.scale * 100) : 100;
    setDocumentZoom((previous) => previous?.url === fileUrl && previous.percent === percent
      ? previous
      : { url: fileUrl, percent });
  }, [fileUrl]);
  const showMarkdown = /\.(md|markdown)$/i.test(selectedPath);
  const loadVersions = async () => {
    const request = ++versionRequest.current;
    if (versionError) setVersionResult(undefined);
    const query = new URLSearchParams({ token, action: "versions", path: selectedPath });
    try {
      const response = await fetch(`/api/code?${query}`, { headers: withAuthHeaders() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { versions } = await response.json() as { versions: { id: string; time?: string }[] };
      if (request === versionRequest.current) setVersionResult({ scope: versionScope, items: versions });
    } catch {
      if (request === versionRequest.current) setVersionResult({ scope: versionScope });
    }
  };
  const historical = historicalResult?.url === fileUrl ? historicalResult : undefined;
  const historicalStatus = !historical ? "loading" : "error" in historical ? "error" : "ready";
  const selected = version
    ? { code: historical && "content" in historical ? historical.content : "" }
    : files[selectedPath];

  useEffect(() => {
    if (!version || !showMarkdown) return;
    const controller = new AbortController();
    void fetch(fileUrl, { headers: withAuthHeaders(), signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("无法读取文件");
        return response.text();
      })
      .then((content) => {
        if (controller.signal.aborted) return;
        setHistoricalResult({ url: fileUrl, content });
      })
      .catch(() => { if (!controller.signal.aborted) setHistoricalResult({ url: fileUrl, error: true }); });
    return () => controller.abort();
  }, [fileUrl, showMarkdown, version, previewAttempt]);
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (!selected || downloading) return;
    setDownloading(true);
    try {
      await downloadWorkspaceArtifact(token, selectedPath, version);
    } catch {
      toast({ title: "无法下载文件，请稍后重试", status: "error" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Flex as="aside" ref={panelRef} aria-label="工作成果" onKeyDown={(event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    }} position={{ base: "absolute", lg: expanded ? "absolute" : "relative" }}
      inset={{ base: 0, lg: expanded ? 0 : "auto" }} zIndex={{ base: 4, md: 2 }} w={{ base: "full", lg: expanded ? "full" : `${paneWidth}%` }}
      minW={{ lg: "360px" }} maxW={{ lg: expanded ? "none" : "900px" }} direction="column" bg="white"
      borderLeftWidth={{ base: 0, lg: "1px" }} borderColor="gray.200" minH={0}>
      {!expanded && (
        <Box
          role="separator"
          aria-label="调整成果面板宽度"
          aria-orientation="vertical"
          aria-valuemin={35}
          aria-valuemax={75}
          aria-valuenow={paneWidth}
          tabIndex={0}
          display={{ base: "none", lg: "block" }}
          position="absolute"
          insetY={0}
          left="-4px"
          w="8px"
          zIndex={1}
          cursor="col-resize"
          sx={{ touchAction: "none" }}
          _hover={{ bg: "gray.200" }}
          _focusVisible={{ bg: "gray.200", outline: "none" }}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const bounds = panelRef.current?.parentElement?.getBoundingClientRect();
            if (bounds?.width) resizePane(Math.round((bounds.right - event.clientX) / bounds.width * 100));
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            resizePane(paneWidth + (event.key === "ArrowLeft" ? 5 : -5));
          }}
        />
      )}
      <Flex px={{ base: 2, md: 4 }} py={3} align="center" gap={{ base: 1, md: 2 }} borderBottom="1px solid" borderColor="gray.100">
        {selected ? <>
          <IconButton ref={backButtonRef} aria-label="返回工作成果列表" icon={<ArrowLeft size={16} />} size="sm" variant="ghost"
            onClick={() => { listFocusPath.current = selectedPath; setExpanded(false); onShowList(); }} />
          <Menu>
          <MenuButton as={Button} variant="ghost" size="sm" rightIcon={<ChevronDown size={15} />}
            leftIcon={<ArtifactFileIcon name={selectedPath} compact />}
            minW={0} flex="1 1 auto" aria-label="选择工作成果" title={selectedPath}>
            <Text as="span" isTruncated>{selectedPath.split("/").pop() || "工作成果"}</Text>
            {version && <Text as="span" fontSize="xs" fontWeight="normal" color="gray.500" ml={2}>{selectedVersionLabel}</Text>}
          </MenuButton>
          <MenuList maxH="min(45vh, 320px)" overflowY="auto" maxW="min(84vw, 460px)">
            {paths.length ? paths.map((path) => (
              <MenuItem key={path} bg={!version && path === selectedPath ? "gray.100" : undefined}
                onClick={() => onSelect(path)} title={path} icon={<ArtifactFileIcon name={path} compact />}>
                <Text isTruncated>{path}</Text>
              </MenuItem>
            )) : <MenuItem isDisabled>暂无工作成果</MenuItem>}
          </MenuList>
          </Menu>
        </> : <Text flex={1} pl={2} fontSize="sm" fontWeight={600}>工作成果</Text>}
        {selected && (
          <Menu placement="bottom-end" onOpen={() => void loadVersions()}>
            <MenuButton as={IconButton} aria-label="版本历史" title={version ? `正在查看${selectedVersionLabel}` : "版本历史"}
              icon={<History size={17} />} size="sm" variant={version ? "solid" : "ghost"} />
            <MenuList maxH="min(50vh, 360px)" overflowY="auto" maxW="calc(100vw - 24px)">
              {files[selectedPath] && (
                <MenuItem onClick={() => onSelectVersion()} aria-current={version ? undefined : "true"} fontWeight={version ? "normal" : "semibold"}>
                  当前文件
                </MenuItem>
              )}
              {versionList?.map((entry, index) => (
                <MenuItem key={entry.id} aria-current={version === entry.id ? "true" : undefined} fontWeight={version === entry.id ? "semibold" : "normal"}
                  onClick={() => onSelectVersion(entry.id)}>
                  版本 {versionList.length - index}
                  {entry.time && <Text as="span" ml={3} fontSize="xs" color="gray.500">{new Date(entry.time).toLocaleString()}</Text>}
                </MenuItem>
              ))}
              {versionError ? <MenuItem onClick={() => void loadVersions()}>加载失败，重试</MenuItem>
                : !versionList ? <MenuItem isDisabled>正在加载版本…</MenuItem>
                : !versionList.length ? <MenuItem isDisabled>暂无历史版本</MenuItem> : null}
            </MenuList>
          </Menu>
        )}
        {selected && isSpreadsheet && !version && (
          <Button size="sm" variant="ghost" flexShrink={0} px={2} aria-pressed={revisionTarget === fileUrl}
            onClick={() => setRevisionTarget(revisionTarget === fileUrl ? undefined : fileUrl)}>
            请求修改
          </Button>
        )}
        {selected && isSpreadsheet && (
          <PreviewZoomMenu label="表格缩放" zoom={spreadsheetZoom} onChange={setSpreadsheetZoom} />
        )}
        {selected && showDocumentZoom && (
          <PreviewZoomMenu label="文档缩放" zoom={documentZoom?.url === fileUrl ? documentZoom.percent : 100}
            onChange={(zoom) => {
              void viewerHandle.current?.applyViewState({ scale: zoom / 100 }).catch(() => undefined);
            }} />
        )}
        {selected && (
          <IconButton aria-label="分享文件" title="分享文件" icon={<Share2 size={15} />}
            size="sm" variant="ghost" onClick={() => setSharingFile(fileUrl)} />
        )}
        {selected && (
          <IconButton aria-label="下载文件" title="下载文件" icon={<Download size={15} />}
            size="sm" variant="ghost" isLoading={downloading} onClick={() => void download()} />
        )}
        {selected && <IconButton
          display={{ base: "none", lg: "inline-flex" }}
          aria-label={expanded ? "退出完整视图" : "进入完整视图"}
          aria-pressed={expanded}
          icon={expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          size="sm"
          variant="ghost"
          onClick={() => setExpanded((value) => !value)}
        />}
        <IconButton ref={closeButtonRef} aria-label="关闭工作成果" icon={<X size={16} />} size="sm" variant="ghost" onClick={onClose} />
      </Flex>
      <Box flex={1} minH={0} overflow="auto" p={showMarkdown ? 4 : 0}>
        {version && showMarkdown && historicalStatus !== "ready" ? (
          historicalStatus === "loading" ? <Text fontSize="sm">正在加载回复版本…</Text> : (
            <Flex direction="column" align="center" justify="center" h="full" gap={3} role="status">
              <Text fontSize="sm" color="gray.600">无法加载此文件</Text>
              <Button size="sm" variant="outline" onClick={retryPreview}>重试</Button>
            </Flex>
          )
        ) : selected && isSpreadsheet ? (
          <FilePreviewPanel key={`${fileUrl}:${previewAttempt}`} onRetry={retryPreview} spreadsheetZoom={spreadsheetZoom}
            onSelectSpreadsheetCell={revisionTarget === fileUrl
              ? (sheet, address) => {
                setRevisionTarget(undefined);
                onRequestRevision(`请修改文件「${selectedPath}」的工作表「${sheet}」中 ${address} ${address.includes(":") ? "单元格区域" : "单元格"}：`);
              }
              : undefined}
            localOnly version={version} token={token} activeFile={selectedPath} sourceCode={version ? "" : selected.code} />
        ) : selected && showMarkdown ? (
          <Box lineHeight="1.7" overflowWrap="anywhere" sx={{
            "& h1, & h2, & h3": { fontWeight: 600, mt: 4, mb: 2 },
            "& h1": { fontSize: "2xl" },
            "& h2": { fontSize: "xl" },
            "& p, & ul, & ol, & pre, & table": { mb: 4 },
            "& ul, & ol": { pl: 6 },
            "& pre": { overflowX: "auto", bg: "gray.50", p: 3, borderRadius: "md" },
            "& th, & td": { border: "1px solid", borderColor: "gray.200", px: 2, py: 1 },
            "& a": { textDecoration: "underline" },
          }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.code}</ReactMarkdown>
          </Box>
        ) : selected ? (
          <ExtendedFilePreview key={`${fileUrl}:${previewAttempt}`} url={fileUrl}
            name={selectedPath.split("/").pop() || selectedPath} onRetry={retryPreview}
            viewerRef={showDocumentZoom ? setViewerHandle : undefined}
            onStateChange={showDocumentZoom ? onDocumentStateChange : undefined} />
        ) : (
          <Accordion allowMultiple defaultIndex={[0, 1]} px={4} py={3}>
            <ArtifactSection label="输出">
              {paths.length ? paths.map((path) => {
              const name = path.split("/").pop() || path;
              return (
                <Flex as="button" type="button" key={path} align="center" textAlign="left" gap={3} px={2} py={2}
                  w="full" borderRadius="lg" title={path} _hover={{ bg: "gray.50" }}
                  ref={(button: HTMLButtonElement | null) => {
                    if (button) listButtons.current.set(path, button);
                    else listButtons.current.delete(path);
                  }}
                  onClick={() => { listFocusPath.current = path; onSelect(path); }}>
                  <ArtifactFileIcon name={name} />
                  <Box flex={1} minW={0}>
                    <Text isTruncated fontSize="sm" fontWeight={500}>{name}</Text>
                    <Text fontSize="xs" color="gray.500">{artifactFileType(name).label}</Text>
                  </Box>
                  <ChevronRight size={16} aria-hidden="true" />
                </Flex>
              );
            }) : <Text px={2} py={3} fontSize="sm" color="gray.500">暂无工作成果</Text>}
            </ArtifactSection>
            {sources.length > 0 && conversationId && (
              <ArtifactSection label="来源">
                {sources.map((file) => (
                  <Flex as="a" key={file.storagePath} href={buildDownloadUrl({ storagePath: file.storagePath!, token, chatId: conversationId })}
                    align="center" gap={3} px={2} py={2} borderRadius="lg" _hover={{ bg: "gray.50" }}
                    aria-label={`下载来源 ${file.name}`}>
                    <ArtifactFileIcon name={file.name} />
                    <Text flex={1} minW={0} fontSize="sm" isTruncated>{file.name}</Text>
                    <Download size={16} aria-hidden="true" />
                  </Flex>
                ))}
              </ArtifactSection>
            )}
          </Accordion>
        )}
      </Box>
      {sharingFile === fileUrl && selected && (
        <ArtifactShareDialog token={token} path={selectedPath} version={version} onClose={() => setSharingFile(undefined)} />
      )}
    </Flex>
  );
}
