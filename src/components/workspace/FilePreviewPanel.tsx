import { Box, Image, Spinner, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

type PreviewKind = "image" | "pdf" | "docx" | "spreadsheet" | "presentation" | "unknown";

const imageExtSet = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const imageMimeByExt: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

const getPreviewKind = (filePath: string): PreviewKind => {
  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  if (imageExtSet.has(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "docx";
  if (extension === "xlsx" || extension === "xls" || extension === "csv") return "spreadsheet";
  if (extension === "pptx" || extension === "ppt") return "presentation";
  return "unknown";
};

const toImageSrc = (filePath: string, code: string) => {
  const value = code.trim().replace(/^['"]|['"]$/g, "");
  if (!value) return "";
  if (value.startsWith("data:image/")) return value;
  if (value.startsWith("data:")) {
    const dataUrlMatch = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (dataUrlMatch && dataUrlMatch[2]) {
      const extension = filePath.split(".").pop()?.toLowerCase() || "";
      const mime = imageMimeByExt[extension] || "image/png";
      const normalizedBase64 = dataUrlMatch[3].replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
      return `data:${mime};base64,${normalizedBase64}`;
    }
    return value;
  }
  if (value.startsWith("<svg") || (value.startsWith("<?xml") && value.includes("<svg"))) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`;
  }

  const normalizedBase64 = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  const mime = imageMimeByExt[extension] || "image/png";
  const isLikelyBase64 =
    normalizedBase64.length > 0 &&
    normalizedBase64.length % 4 === 0 &&
    /^[A-Za-z0-9+/=]+$/.test(normalizedBase64);
  if (isLikelyBase64) {
    return `data:${mime};base64,${normalizedBase64}`;
  }
  return "";
};

const toInlineUrl = (code: string) => {
  const value = code.trim().replace(/^['"]|['"]$/g, "");
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")) return value;
  return "";
};

const isLikelyPublicHttpsUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = (url.hostname || "").toLowerCase();
    if (!host) return false;
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.includes("host.docker.internal")
    ) {
      return false;
    }
    if (
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

const buildContentFingerprint = (value: string) => {
  const len = value.length;
  if (len === 0) return "0::";
  const head = value.slice(0, 64);
  const tail = value.slice(-64);
  return `${len}:${head}:${tail}`;
};

type FilePreviewPanelProps = {
  token: string;
  activeFile: string;
  sourceCode: string;
};

type PreviewCacheEntry =
  | { kind: "pdf"; binaryObjectUrl: string }
  | { kind: "docx"; docxHtml: string }
  | { kind: "spreadsheet"; officePreviewUrl: string; sheetName: string; sheetRows: string[][] }
  | { kind: "presentation"; officePreviewUrl: string; pptSlides: string[][] };

const FilePreviewPanel = ({ token, activeFile, sourceCode }: FilePreviewPanelProps) => {
  const previewKind = getPreviewKind(activeFile);
  const sourceHash = sourceCode.length;
  const previewCacheKey = `${token}::${activeFile}`;
  const sourceFingerprint = useMemo(() => buildContentFingerprint(sourceCode), [sourceCode]);
  const viewBinaryUrl = useMemo(
    () =>
      token && activeFile
        ? `/api/code?token=${encodeURIComponent(token)}&action=view&path=${encodeURIComponent(activeFile)}&v=${sourceHash}`
        : "",
    [token, activeFile, sourceHash]
  );
  const viewSignedUrlApi = useMemo(
    () =>
      token && activeFile
        ? `/api/code?token=${encodeURIComponent(token)}&action=view-url&path=${encodeURIComponent(activeFile)}&v=${sourceHash}`
        : "",
    [token, activeFile, sourceHash]
  );

  const inlineImageSrc = previewKind === "image" ? toImageSrc(activeFile, sourceCode) : "";
  const inlineImageUrl = previewKind === "image" ? toInlineUrl(sourceCode) : "";
  const [imageSrc, setImageSrc] = useState("");
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState("");
  const [binaryObjectUrl, setBinaryObjectUrl] = useState("");
  const [officePreviewUrl, setOfficePreviewUrl] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [sheetRows, setSheetRows] = useState<string[][]>([]);
  const [pptSlides, setPptSlides] = useState<string[][]>([]);
  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  const previewCacheRef = useRef<Map<string, PreviewCacheEntry>>(new Map());
  const cachedBlobUrlsRef = useRef<Set<string>>(new Set());
  const fileFingerprintRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    return () => {
      for (const url of cachedBlobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      cachedBlobUrlsRef.current.clear();
      previewCacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    let shouldRevokeObjectUrl = false;

    if (previewKind === "pdf" || previewKind === "docx" || previewKind === "spreadsheet" || previewKind === "presentation") {
      const prevFingerprint = fileFingerprintRef.current.get(previewCacheKey);
      if (prevFingerprint !== sourceFingerprint) {
        const stale = previewCacheRef.current.get(previewCacheKey);
        if (stale && stale.kind === "pdf") {
          URL.revokeObjectURL(stale.binaryObjectUrl);
          cachedBlobUrlsRef.current.delete(stale.binaryObjectUrl);
        }
        previewCacheRef.current.delete(previewCacheKey);
        fileFingerprintRef.current.set(previewCacheKey, sourceFingerprint);
      }
    }

    if (previewKind === "pdf" || previewKind === "docx" || previewKind === "spreadsheet" || previewKind === "presentation") {
      const cached = previewCacheRef.current.get(previewCacheKey);
      if (cached) {
        setDocError("");
        setDocLoading(false);
        setBinaryObjectUrl(cached.kind === "pdf" ? cached.binaryObjectUrl : "");
        setOfficePreviewUrl(cached.kind === "spreadsheet" || cached.kind === "presentation" ? cached.officePreviewUrl : "");
        setSheetName(cached.kind === "spreadsheet" ? cached.sheetName : "");
        setSheetRows(cached.kind === "spreadsheet" ? cached.sheetRows : []);
        setPptSlides(cached.kind === "presentation" ? cached.pptSlides : []);
        if (docxContainerRef.current) {
          docxContainerRef.current.innerHTML = cached.kind === "docx" ? cached.docxHtml : "";
        }
        return () => {
          cancelled = true;
        };
      }
    }

    setDocError("");
    setDocLoading(false);
    setBinaryObjectUrl("");
    setOfficePreviewUrl("");
    setSheetName("");
    setSheetRows([]);
    setPptSlides([]);
    if (docxContainerRef.current) {
      docxContainerRef.current.innerHTML = "";
    }

    const run = async () => {
      try {
        if (previewKind === "image") {
          if (inlineImageSrc) {
            setImageSrc(inlineImageSrc);
            return;
          }
          if (inlineImageUrl) {
            setImageSrc(inlineImageUrl);
            return;
          }
          const res = await fetch(viewBinaryUrl, { headers: withAuthHeaders(), credentials: "include" });
          if (!res.ok) throw new Error(`图片加载失败: ${res.status}`);
          const type = (res.headers.get("content-type") || "").toLowerCase();
          if (type.startsWith("image/")) {
            const blob = await res.blob();
            objectUrl = URL.createObjectURL(blob);
            shouldRevokeObjectUrl = true;
            if (!cancelled) setImageSrc(objectUrl);
            return;
          }
          const text = await res.text();
          const src = toImageSrc(activeFile, text);
          if (!src) throw new Error("返回内容不是可解析图片");
          if (!cancelled) setImageSrc(src);
          return;
        }

        setDocLoading(true);
        const response = await fetch(viewBinaryUrl, { headers: withAuthHeaders(), credentials: "include" });
        if (!response.ok) throw new Error(`加载失败: ${response.status}`);

        if (previewKind === "pdf") {
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) {
            setBinaryObjectUrl(objectUrl);
            previewCacheRef.current.set(previewCacheKey, {
              kind: "pdf",
              binaryObjectUrl: objectUrl,
            });
            cachedBlobUrlsRef.current.add(objectUrl);
          }
          return;
        }

        if (previewKind === "spreadsheet" || previewKind === "presentation") {
          try {
            const signedRes = await fetch(viewSignedUrlApi, {
              headers: withAuthHeaders(),
              credentials: "include",
            });
            if (signedRes.ok) {
              const data = (await signedRes.json()) as { url?: string };
              const signedUrl = typeof data.url === "string" ? data.url : "";
              if (signedUrl && isLikelyPublicHttpsUrl(signedUrl)) {
                const embedUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`;
                if (!cancelled) {
                  setOfficePreviewUrl(embedUrl);
                  if (previewKind === "spreadsheet") {
                    previewCacheRef.current.set(previewCacheKey, {
                      kind: "spreadsheet",
                      officePreviewUrl: embedUrl,
                      sheetName: "",
                      sheetRows: [],
                    });
                  } else {
                    previewCacheRef.current.set(previewCacheKey, {
                      kind: "presentation",
                      officePreviewUrl: embedUrl,
                      pptSlides: [],
                    });
                  }
                }
                return;
              }
            }
          } catch {
            // Fall back to local lightweight parsing below.
          }
        }

        const arrayBuffer = await response.arrayBuffer();
        if (previewKind === "docx") {
          const container = docxContainerRef.current;
          if (!container) throw new Error("Word 预览容器未就绪");
          container.innerHTML = "";
          const docxPreview = await import("docx-preview");
          await docxPreview.renderAsync(arrayBuffer, container, undefined, {
            ignoreWidth: false,
            ignoreHeight: true,
            breakPages: true,
            className: "docx-preview",
            inWrapper: true,
          });
          if (!cancelled) {
            previewCacheRef.current.set(previewCacheKey, {
              kind: "docx",
              docxHtml: container.innerHTML,
            });
          }
          return;
        }
        if (previewKind === "spreadsheet") {
          const XLSX = await import("xlsx");
          const workbook = XLSX.read(arrayBuffer, { type: "array" });
          const firstName = workbook.SheetNames[0] || "";
          const firstSheet = firstName ? workbook.Sheets[firstName] : null;
          const rowsRaw = firstSheet ? (XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false }) as unknown[][]) : [];
          const rows = rowsRaw.slice(0, 200).map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
          if (!cancelled) {
            setSheetName(firstName);
            setSheetRows(rows);
            previewCacheRef.current.set(previewCacheKey, {
              kind: "spreadsheet",
              officePreviewUrl: "",
              sheetName: firstName,
              sheetRows: rows,
            });
          }
          return;
        }
        if (previewKind === "presentation") {
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(arrayBuffer);
          const slideFiles = zip.file(/^ppt\/slides\/slide\d+\.xml$/).sort((a, b) => {
            const an = Number(a.name.match(/slide(\d+)\.xml$/)?.[1] || "0");
            const bn = Number(b.name.match(/slide(\d+)\.xml$/)?.[1] || "0");
            return an - bn;
          });
          const slides: string[][] = [];
          for (const file of slideFiles.slice(0, 30)) {
            const xml = await file.async("string");
            const parser = new DOMParser();
            const doc = parser.parseFromString(xml, "application/xml");
            const nodes = Array.from(doc.getElementsByTagName("a:t"));
            slides.push(nodes.map((node) => (node.textContent || "").trim()).filter(Boolean));
          }
          if (!cancelled) {
            setPptSlides(slides);
            previewCacheRef.current.set(previewCacheKey, {
              kind: "presentation",
              officePreviewUrl: "",
              pptSlides: slides,
            });
          }
        }
      } catch (error) {
        if (!cancelled) setDocError(error instanceof Error ? error.message : "预览失败");
      } finally {
        if (!cancelled) setDocLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (shouldRevokeObjectUrl && objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeFile, inlineImageSrc, inlineImageUrl, previewKind, previewCacheKey, sourceFingerprint, viewBinaryUrl, viewSignedUrlApi]);

  if (previewKind === "unknown") {
    return (
      <Box h="100%" display="flex" alignItems="center" justifyContent="center">
        <Text fontSize="sm" color="gray.600">
          该文件类型暂不支持预览
        </Text>
      </Box>
    );
  }

  if (previewKind === "image") {
    return (
      <Box h="100%" display="flex" alignItems="center" justifyContent="center" background="linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)" p={4}>
        {docError ? (
          <Text fontSize="sm" color="red.500">
            图片预览失败：{docError}
          </Text>
        ) : imageSrc ? (
          <Image
            src={imageSrc}
            alt={activeFile}
            maxH="100%"
            maxW="100%"
            objectFit="contain"
            onError={() => setDocError("浏览器无法解码该图片数据")}
          />
        ) : (
          <Text fontSize="sm" color="gray.600">
            正在加载图片...
          </Text>
        )}
      </Box>
    );
  }

  if (previewKind === "pdf") {
    return (
      <Box h="100%" bg="#f8fafc">
        {docLoading ? (
          <Box h="100%" display="flex" alignItems="center" justifyContent="center" gap={2}>
            <Spinner size="sm" />
            <Text fontSize="sm" color="gray.600">
              正在加载 PDF 预览...
            </Text>
          </Box>
        ) : docError ? (
          <Box h="100%" display="flex" alignItems="center" justifyContent="center" p={4}>
            <Text fontSize="sm" color="red.500">
              PDF 预览失败：{docError}
            </Text>
          </Box>
        ) : (
          <iframe src={binaryObjectUrl} title={activeFile} style={{ width: "100%", height: "100%", border: "none" }} />
        )}
      </Box>
    );
  }

  if (previewKind === "docx") {
    return (
      <Box h="100%" overflow="auto" bg="#f8fafc" p={5} position="relative">
        <Box
          ref={docxContainerRef}
          bg="white"
          border="1px solid #e2e8f0"
          borderRadius="md"
          p={5}
          minH="180px"
          sx={{
            "& .docx-wrapper": {
              background: "white !important",
              padding: "0 !important",
            },
          }}
        />
        {docLoading ? (
          <Box
            position="absolute"
            inset={5}
            display="flex"
            alignItems="center"
            justifyContent="center"
            gap={2}
            bg="rgba(248,250,252,0.72)"
            borderRadius="md"
          >
            <Spinner size="sm" />
            <Text fontSize="sm" color="gray.600">
              正在加载 Word 预览...
            </Text>
          </Box>
        ) : docError ? (
          <Box
            position="absolute"
            inset={5}
            display="flex"
            alignItems="center"
            justifyContent="center"
            p={4}
            bg="rgba(248,250,252,0.8)"
            borderRadius="md"
          >
            <Text fontSize="sm" color="red.500">
              Word 预览失败：{docError}
            </Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  if (previewKind === "spreadsheet") {
    return (
      <Box h="100%" overflow="auto" bg="#f8fafc" p={4}>
        {docLoading ? (
          <Box display="flex" alignItems="center" gap={2}>
            <Spinner size="sm" />
            <Text fontSize="sm" color="gray.600">
              正在解析 Excel 表格...
            </Text>
          </Box>
        ) : docError ? (
          <Text fontSize="sm" color="red.500">
            Excel 预览失败：{docError}
          </Text>
        ) : officePreviewUrl ? (
          <Box h="100%" minH="560px" bg="white" border="1px solid #e2e8f0" borderRadius="md" overflow="hidden">
            <iframe src={officePreviewUrl} title={activeFile} style={{ width: "100%", height: "100%", minHeight: "560px", border: "none" }} />
          </Box>
        ) : (
          <Box>
            <Text fontSize="sm" color="gray.700" mb={2}>
              工作表：{sheetName || "未命名"}（最多显示 200 行）
            </Text>
            <Box border="1px solid #e2e8f0" borderRadius="md" overflow="auto" bg="white">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <tbody>
                  {sheetRows.map((row, rowIndex) => (
                    <tr key={`r-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`c-${rowIndex}-${cellIndex}`} style={{ border: "1px solid #edf2f7", padding: "6px 8px", verticalAlign: "top", whiteSpace: "pre-wrap", minWidth: "80px" }}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box h="100%" overflow="auto" bg="#f8fafc" p={4}>
      {docLoading ? (
        <Box display="flex" alignItems="center" gap={2}>
          <Spinner size="sm" />
          <Text fontSize="sm" color="gray.600">
            正在解析 PPT 文档...
          </Text>
        </Box>
      ) : docError ? (
        <Text fontSize="sm" color="red.500">
          PPT 预览失败：{docError}
        </Text>
      ) : officePreviewUrl ? (
        <Box h="100%" minH="560px" bg="white" border="1px solid #e2e8f0" borderRadius="md" overflow="hidden">
          <iframe src={officePreviewUrl} title={activeFile} style={{ width: "100%", height: "100%", minHeight: "560px", border: "none" }} />
        </Box>
      ) : (
        <Box display="flex" flexDirection="column" gap={3}>
          {pptSlides.length === 0 ? (
            <Text fontSize="sm" color="gray.600">
              未解析到可展示的幻灯片文本内容
            </Text>
          ) : (
            pptSlides.map((slide, index) => (
              <Box key={`slide-${index}`} bg="white" border="1px solid #e2e8f0" borderRadius="md" p={4}>
                <Text fontSize="xs" color="gray.500" mb={2}>
                  幻灯片 {index + 1}
                </Text>
                {slide.length === 0 ? (
                  <Text fontSize="sm" color="gray.500">
                    （无文本内容）
                  </Text>
                ) : (
                  <Box as="ul" pl={4}>
                    {slide.map((line, lineIndex) => (
                      <Box as="li" key={`slide-${index}-line-${lineIndex}`} fontSize="sm" color="gray.700" mb={1}>
                        {line}
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            ))
          )}
        </Box>
      )}
    </Box>
  );
};

export const isPreviewableFile = (filePath: string) => getPreviewKind(filePath) !== "unknown";

export default FilePreviewPanel;
