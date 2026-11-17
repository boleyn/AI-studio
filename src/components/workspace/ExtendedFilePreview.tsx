import { Button, Flex, Spinner, Text } from "@chakra-ui/react";
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

export default function ExtendedFilePreview({ url, name, onRetry, viewerRef, onStateChange }: {
  url: string;
  name: string;
  onRetry: () => void;
  viewerRef?: ViewerProps["viewerRef"];
  onStateChange?: FileViewerProps["onStateChange"];
}) {
  const [result, setResult] = useState<{ file: File } | { error: true }>();

  const handleViewerState = useCallback<NonNullable<FileViewerProps["onStateChange"]>>((state) => {
    onStateChange?.(state);
    if (state.error && !state.loading) setResult({ error: true });
  }, [onStateChange]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { headers: withAuthHeaders(), signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (!controller.signal.aborted) setResult({ file: new File([blob], name, { type: blob.type }) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ error: true });
      });

    return () => controller.abort();
  }, [url, name]);

  if (!result || "error" in result) {
    return <Flex h="full" direction="column" align="center" justify="center" gap={3} role="status">
      {!result ? <Spinner size="sm" aria-label="正在加载文件" /> : <>
        <Text fontSize="sm" color="gray.600">无法加载此文件</Text>
        <Button size="sm" variant="outline" onClick={onRetry}>重试</Button>
      </>}
    </Flex>;
  }

  return <FileViewer file={result.file} viewerRef={viewerRef} onStateChange={handleViewerState}
    options={isArtifactImage(name) ? imageOptions : viewerRef ? documentOptions : options} style={{ width: "100%", height: "100%" }} />;
}
