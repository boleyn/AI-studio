import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import FilePreviewPanel, { isPreviewableFile } from "../workspace/FilePreviewPanel";
import { Box, Button, Flex, IconButton, Menu, MenuButton, MenuItem, MenuList, Text, useToast } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { ChevronDown, Download, Maximize2, Minimize2, X } from "lucide-react";

type Props = {
  token: string;
  version?: string;
  files: Record<string, { code: string }>;
  selectedPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
};

export default function WorkspaceFilesPanel({ token, version, files, selectedPath, onSelect, onClose }: Props) {
  const [expanded, setExpanded] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const paths = Object.keys(files).sort();
  const [historicalResult, setHistoricalResult] = useState<
    { url: string; content: string } | { url: string; error: true }
  >();
  const query = new URLSearchParams({ token, action: "view", path: selectedPath });
  if (version) query.set("version", version);
  const fileUrl = `/api/code?${query}`;
  const previewable = isPreviewableFile(selectedPath);
  const historical = historicalResult?.url === fileUrl ? historicalResult : undefined;
  const historicalStatus = !historical ? "loading" : "error" in historical ? "error" : "ready";
  const selected = version
    ? { code: historical && "content" in historical ? historical.content : "" }
    : files[selectedPath];

  useEffect(() => {
    if (!version || previewable) return;
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
  }, [fileUrl, previewable, version]);
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (!selected || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(fileUrl, { headers: withAuthHeaders() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = selectedPath.split("/").pop() || "file";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast({ title: "无法下载文件，请稍后重试", status: "error" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Flex as="aside" aria-label="工作成果" onKeyDown={(event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    }} position={{ base: "absolute", lg: expanded ? "absolute" : "relative" }}
      inset={{ base: 0, lg: expanded ? 0 : "auto" }} zIndex={2} w={{ base: "full", lg: expanded ? "full" : "50%" }}
      minW={{ lg: "360px" }} maxW={{ lg: expanded ? "none" : "900px" }} direction="column" bg="white"
      borderLeftWidth={{ base: 0, lg: "1px" }} borderColor="gray.200" minH={0}>
      <Flex px={4} py={3} align="center" gap={2} borderBottom="1px solid" borderColor="gray.100">
        <Menu>
          <MenuButton as={Button} variant="ghost" size="sm" rightIcon={<ChevronDown size={15} />}
            minW={0} flexShrink={1} aria-label="选择工作成果" title={selectedPath}>
            <Text isTruncated>{selectedPath.split("/").pop() || "工作成果"}</Text>
          </MenuButton>
          <MenuList maxH="min(45vh, 320px)" overflowY="auto" maxW="min(84vw, 460px)">
            {paths.length ? paths.map((path) => (
              <MenuItem key={path} bg={!version && path === selectedPath ? "gray.100" : undefined}
                onClick={() => onSelect(path)} title={path}>
                <Text isTruncated>{path}</Text>
              </MenuItem>
            )) : <MenuItem isDisabled>暂无工作成果</MenuItem>}
          </MenuList>
        </Menu>
        {version && <Text fontSize="xs" color="gray.500" flexShrink={0}>回复版本</Text>}
        <Box flex={1} />
        {selected && (
          <IconButton aria-label="下载文件" title="下载文件" icon={<Download size={15} />}
            size="sm" variant="ghost" isLoading={downloading} onClick={() => void download()} />
        )}
        <IconButton
          display={{ base: "none", lg: "inline-flex" }}
          aria-label={expanded ? "恢复并排预览" : "扩大预览"}
          aria-pressed={expanded}
          icon={expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          size="sm"
          variant="ghost"
          onClick={() => setExpanded((value) => !value)}
        />
        <IconButton ref={closeButtonRef} aria-label="关闭工作成果" icon={<X size={16} />} size="sm" variant="ghost" onClick={onClose} />
      </Flex>
      <Box flex={1} overflow="auto" p={4}>
        {version && !previewable && historicalStatus !== "ready" ? (
          <Text fontSize="sm">{historicalStatus === "loading" ? "正在加载回复版本…" : "无法读取此版本"}</Text>
        ) : selected && previewable ? (
          <FilePreviewPanel key={fileUrl} localOnly version={version} token={token} activeFile={selectedPath} sourceCode={version ? "" : selected.code} />
        ) : selected && /\.(md|markdown)$/i.test(selectedPath) ? (
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
        ) : (
        <Box as="pre" fontSize="12px" lineHeight="1.7" fontFamily="mono" whiteSpace="pre-wrap" overflowWrap="anywhere">
          {selected?.code ?? "选择文件查看内容"}
        </Box>
        )}
      </Box>
    </Flex>
  );
}
