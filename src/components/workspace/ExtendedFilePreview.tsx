import { Button, Flex, Spinner, Text } from "@chakra-ui/react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { isArtifactImage } from "./ArtifactFileIcon";
import type { FileViewerProps } from "@file-viewer/react-full";

const FileViewer = dynamic<FileViewerProps>(
  () => import("@file-viewer/react-full").then((module) => module.FileViewer),
  { ssr: false, loading: () => <Spinner size="sm" aria-label="正在加载预览器" /> },
);

const options = {
  locale: "zh-CN",
  theme: "light",
  toolbar: { download: false, print: false, exportHtml: false, theme: false },
} satisfies FileViewerProps["options"];

const imageOptions: FileViewerProps["options"] = {
  ...options,
  toolbar: { ...options.toolbar, zoom: false, search: false },
};

export default function ExtendedFilePreview({ url, name, onRetry }: {
  url: string;
  name: string;
  onRetry: () => void;
}) {
  const [result, setResult] = useState<{ file: File } | { error: true }>();

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

  return <FileViewer file={result.file} options={isArtifactImage(name) ? imageOptions : options} style={{ width: "100%", height: "100%" }} />;
}
