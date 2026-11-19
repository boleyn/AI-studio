import { LibraryReadError, libraryReadMessage } from "@features/chat/services/libraryAttachment";
import { redirectedToLogin } from "@features/chat/services/files";
import InteractiveHtmlPreview from "./InteractiveHtmlPreview";
import LibraryMarkdown from "../agent-workspace/LibraryMarkdown";
import { Box, Button, Flex, Spinner, Text } from "@chakra-ui/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { isArtifactImage } from "./ArtifactFileIcon";
import type { FileViewerHandle, FileViewerProps } from "@file-viewer/react-full";

type ViewerProps = FileViewerProps & { viewerRef?: (viewer: FileViewerHandle | null) => void };

const FileViewer = dynamic<ViewerProps>(
  () => import("@file-viewer/react-full").then(({ FileViewer: Viewer }) =>
    function ViewerWithHandle({ viewerRef, ...props }: ViewerProps) {
      return <Viewer {...props} ref={viewerRef} />;
    }),
  { ssr: false, loading: () => <Spinner size="sm" aria-label="正在加载预览器" /> },
);

const options = {
  locale: "zh-CN",
  theme: "light",
  toolbar: { download: false, print: false, exportHtml: false, theme: false },
} satisfies FileViewerProps["options"];

const documentOptions = {
  ...options,
  toolbar: { ...options.toolbar, zoom: false, search: false },
} satisfies FileViewerProps["options"];

const imageOptions: FileViewerProps["options"] = {
  ...documentOptions,
  image: { rotation: false },
};

async function validateOfficePackage(blob: Blob, name: string) {
  if (!/\.(docx|docm|dotx|dotm|pptx|pptm|potx|potm|ppsx|ppsm)$/i.test(name)) return;
  const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const isZip = [0x50, 0x4b, 0x03, 0x04].every((byte, index) => header[index] === byte);
  const isEncryptedContainer = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
    .every((byte, index) => header[index] === byte);
  if (!isZip && !isEncryptedContainer) throw new Error("Invalid Office file header");
}

export default function ExtendedFilePreview({ url, name, onRetry, viewerRef, onStateChange, interactivePages }: {
  url: string;
  name: string;
  onRetry: () => void;
  interactivePages?: boolean;
  viewerRef?: ViewerProps["viewerRef"];
  onStateChange?: FileViewerProps["onStateChange"];
}) {
  const standalone = !viewerRef && !onStateChange;
  const [result, setResult] = useState<{ file: File } | { markdown: string } | { html: string } | { error: string }>();

  const handleViewerState = useCallback<NonNullable<FileViewerProps["onStateChange"]>>((state) => {
    onStateChange?.(state);
    if (state.error && !state.loading) setResult({ error: "无法预览此文件的内容。" });
  }, [onStateChange]);

  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined);
    fetch(url, { headers: withAuthHeaders(), signal: controller.signal })
      .then((response) => {
        if (redirectedToLogin(response)) throw new LibraryReadError(401,name);
        if (!response.ok) throw new LibraryReadError(response.status,name);
        return response.blob();
      })
      .then(async (blob) => {
        if (standalone && (/\.(md|markdown)$/i.test(name) || /^text\/(?:x-)?markdown(?:;|$)/i.test(blob.type))) {
          const markdown = await blob.text();
          if (!controller.signal.aborted) setResult({markdown});
          return;
        }
        if (standalone && /\.html?$/i.test(name)) {
          const html = await blob.text();
          if (!controller.signal.aborted) setResult({html});
          return;
        }
        await validateOfficePackage(blob, name);
        if (!controller.signal.aborted) setResult({ file: new File([blob], name, { type: blob.type }) });
      })
      .catch(reason => {
        if (!controller.signal.aborted) setResult({ error: reason instanceof LibraryReadError ? libraryReadMessage(reason) :
          reason instanceof TypeError ? "连接失败，请检查网络后重试。" : "无法预览此文件的内容。" });
      });

    return () => controller.abort();
  }, [url, name, standalone]);

  if (!result || "error" in result) {
    return <Flex h="full" direction="column" align="center" justify="center" gap={3} role="status">
      {!result ? <Spinner size="sm" aria-label="正在加载文件" /> : <>
        <Text fontSize="sm" color="gray.600">{result.error}</Text>
        <Button size="sm" variant="outline" onClick={onRetry}>重试</Button>
      </>}
    </Flex>;
  }

  if ("html" in result) return <InteractiveHtmlPreview name={name} body={result.html}/>;
  if ("markdown" in result) return <Box h="full" overflowY="auto" px={4} py={6}><Box maxW="760px" mx="auto"><LibraryMarkdown interactivePages={interactivePages}>{result.markdown}</LibraryMarkdown></Box></Box>;

  return <FileViewer file={result.file} viewerRef={viewerRef} onStateChange={handleViewerState}
    options={isArtifactImage(name) ? imageOptions : viewerRef ? documentOptions : options} style={{ width: "100%", height: "100%" }} />;
}
