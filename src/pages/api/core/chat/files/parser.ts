import { readFile as readTextFile } from "node:fs/promises";
import path from "node:path";

import { readRawContentFromBuffer } from "@server/worker/readFile";
import JSZip from "jszip";
import JSON5 from "json5";
import type { FileParseInfo } from "./types";

type CustomPdfParseConfig = {
  url?: string;
  mode?: "sync" | "async";
  key?: string;
  doc2xKey?: string;
  modelVersion?: "pipeline" | "vlm";
  textinAppId?: string;
  textinSecretCode?: string;
  price?: number;
};

const MAX_MARKDOWN_LENGTH = 12_000;
const DEFAULT_CONFIG_FILE = "config/config.json";

const TEXT_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".css",
  ".html",
  ".xml",
  ".yml",
  ".yaml",
  ".log",
  ".csv",
]);

const truncateMarkdown = (value: string) =>
  value.length > MAX_MARKDOWN_LENGTH ? `${value.slice(0, MAX_MARKDOWN_LENGTH)}\n\n...[truncated]` : value;

const isTextLikeFile = (fileName: string, type?: string) => {
  if (type && type.startsWith("text/")) return true;
  const ext = path.extname(fileName).toLowerCase();
  return TEXT_FILE_EXTENSIONS.has(ext);
};

const isImageFile = (fileName: string, type?: string) => {
  if (type && type.startsWith("image/")) return true;
  const ext = path.extname(fileName).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"].includes(ext);
};

const getCodeFenceLanguage = (fileName: string) => {
  const ext = path.extname(fileName).toLowerCase();
  const mapping: Record<string, string> = {
    ".ts": "ts",
    ".tsx": "tsx",
    ".js": "js",
    ".jsx": "jsx",
    ".json": "json",
    ".py": "python",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".css": "css",
    ".html": "html",
    ".md": "markdown",
    ".xml": "xml",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".txt": "text",
    ".csv": "csv",
  };
  return mapping[ext] || "text";
};

const buildMetadataMarkdown = ({ name, type, size }: { name: string; type: string; size: number }) =>
  [
    `### 文件元信息`,
    `- 文件名: ${name}`,
    `- 类型: ${type || "application/octet-stream"}`,
    `- 大小: ${size} bytes`,
    `- 说明: 当前仅提供元信息。`,
  ].join("\n");

const formatTextMarkdown = ({ fileName, content }: { fileName: string; content: string }) => {
  const language = getCodeFenceLanguage(fileName);
  return [`### 文件内容: ${fileName}`, "", `\`\`\`${language}`, content, "\`\`\`"].join("\n");
};

const resolveConfigFilePath = () => {
  const configured = process.env.CHAT_MODEL_CONFIG_FILE?.trim();
  const relativePath = configured || DEFAULT_CONFIG_FILE;
  return path.isAbsolute(relativePath) ? relativePath : path.join(process.cwd(), relativePath);
};

const extractCustomPdfParseConfig = (raw: unknown): CustomPdfParseConfig => {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;

  const readString = (key: string) => {
    const value = record[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const readMode = () => {
    const value = readString("mode");
    if (value === "sync" || value === "async") return value;
    return undefined;
  };
  const readModelVersion = () => {
    const value = readString("modelVersion");
    if (value === "pipeline" || value === "vlm") return value;
    return undefined;
  };

  const priceValue = record.price;
  return {
    url: readString("url") || undefined,
    mode: readMode(),
    key: readString("key") || undefined,
    doc2xKey: readString("doc2xKey") || undefined,
    modelVersion: readModelVersion(),
    textinAppId: readString("textinAppId") || undefined,
    textinSecretCode: readString("textinSecretCode") || undefined,
    price: typeof priceValue === "number" && Number.isFinite(priceValue) ? priceValue : undefined,
  };
};

export const readCustomPdfParseConfig = async (): Promise<CustomPdfParseConfig> => {
  try {
    const filePath = resolveConfigFilePath();
    const raw = await readTextFile(filePath, "utf8");
    const parsed = JSON5.parse(raw) as Record<string, unknown>;

    const fromSystemEnv =
      parsed.systemEnv && typeof parsed.systemEnv === "object"
        ? (parsed.systemEnv as Record<string, unknown>).customPdfParse
        : undefined;

    const fromRoot = parsed.customPdfParse;
    const merged = extractCustomPdfParseConfig(fromSystemEnv || fromRoot);
    if (merged.url) {
      return merged;
    }
  } catch {
    // fallback to env
  }

  const fromEnvUrl = process.env.CUSTOM_PDF_PARSE_ENDPOINT?.trim() || process.env.MINERU_API_ENDPOINT?.trim();
  const fromEnvKey = process.env.CUSTOM_PDF_PARSE_API_KEY?.trim() || process.env.MINERU_API_KEY?.trim();

  if (fromEnvUrl) {
    return {
      url: fromEnvUrl,
      key: fromEnvKey || undefined,
      mode: "sync",
      modelVersion: "vlm",
    };
  }

  return {};
};

const extractMarkdownFromResponse = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  if (typeof record.markdown === "string") return record.markdown;

  const data = record.data;
  if (data && typeof data === "object") {
    const dataMarkdown = (data as Record<string, unknown>).markdown;
    if (typeof dataMarkdown === "string") return dataMarkdown;
  }

  const result = record.result;
  if (result && typeof result === "object") {
    const resultMarkdown = (result as Record<string, unknown>).markdown;
    if (typeof resultMarkdown === "string") return resultMarkdown;
  }

  return "";
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async (url: string, init: RequestInit, timeoutMs = 600000) => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: abort.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const parsePdfWithSystemParser = async ({
  fileName,
  buffer,
}: {
  fileName: string;
  buffer: Buffer;
}): Promise<FileParseInfo> => {
  try {
    const parsed = await readRawContentFromBuffer({
      extension: "pdf",
      encoding: "utf8",
      buffer,
    });

    const text = (parsed.formatText || parsed.rawText || "").trim();

    const markdown = text.trim()
      ? truncateMarkdown(formatTextMarkdown({ fileName, content: text }))
      : buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength });

    return {
      status: text.trim() ? "success" : "skipped",
      progress: 100,
      parser: "text",
      markdown,
      error: text.trim() ? undefined : "系统 PDF 解析无可读文本，已回退元信息。",
    };
  } catch (error) {
    return {
      status: "error",
      progress: 100,
      parser: "metadata",
      markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
      error: error instanceof Error ? error.message : "系统 PDF 解析失败",
    };
  }
};

const parseHtmlWithSystemParser = async ({
  fileName,
  buffer,
}: {
  fileName: string;
  buffer: Buffer;
}): Promise<FileParseInfo> => {
  try {
    const html = buffer.toString("utf8");
    const turndown = (await import("turndown")).default;
    const service = new turndown();
    const markdownBody = service.turndown(html).trim();
    const markdown = truncateMarkdown([
      `### 文件内容: ${fileName}`,
      "",
      markdownBody || buildMetadataMarkdown({ name: fileName, type: "text/html", size: buffer.byteLength }),
    ].join("\n"));

    return {
      status: "success",
      progress: 100,
      parser: "text",
      markdown,
    };
  } catch (error) {
    return {
      status: "error",
      progress: 100,
      parser: "metadata",
      markdown: buildMetadataMarkdown({ name: fileName, type: "text/html", size: buffer.byteLength }),
      error: error instanceof Error ? error.message : "HTML 解析失败",
    };
  }
};

const escapeMdCell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, "\\n");

const toMarkdownTable = (rows: string[][]) => {
  if (rows.length === 0) return "";
  const header = rows[0];
  if (!header || header.length === 0) return "";
  const body = rows.slice(1);
  return [
    `| ${header.map((item) => escapeMdCell(item || "")).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.map((item) => escapeMdCell(item || "")).join(" | ")} |`),
  ].join("\n");
};

const parseCsvWithSystemParser = async ({
  fileName,
  buffer,
}: {
  fileName: string;
  buffer: Buffer;
}): Promise<FileParseInfo> => {
  try {
    const Papa = (await import("papaparse")).default;
    const raw = buffer.toString("utf8");
    const csvRows = (Papa.parse<string[]>(raw).data || []).map((row) =>
      Array.isArray(row) ? row.map((item) => String(item ?? "")) : []
    );
    const table = toMarkdownTable(csvRows);

    const markdown = truncateMarkdown(
      table
        ? [`### 文件内容: ${fileName}`, "", table].join("\n")
        : buildMetadataMarkdown({ name: fileName, type: "text/csv", size: buffer.byteLength })
    );

    return {
      status: table ? "success" : "skipped",
      progress: 100,
      parser: "text",
      markdown,
      error: table ? undefined : "CSV 无可解析表格。",
    };
  } catch (error) {
    return {
      status: "error",
      progress: 100,
      parser: "metadata",
      markdown: buildMetadataMarkdown({ name: fileName, type: "text/csv", size: buffer.byteLength }),
      error: error instanceof Error ? error.message : "CSV 解析失败",
    };
  }
};

const parseXlsxWithSystemParser = async ({
  fileName,
  buffer,
}: {
  fileName: string;
  buffer: Buffer;
}): Promise<FileParseInfo> => {
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, {
      cellDates: false,
      raw: false,
    });

    const sections = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      }) as string[][];
      const normalizedRows = rows.map((row) => row.map((item) => String(item ?? "")));
      const table = toMarkdownTable(normalizedRows);
      if (!table) return "";
      return [`#### Sheet: ${sheetName}`, "", table].join("\n");
    }).filter(Boolean);

    const markdown = truncateMarkdown(
      sections.length > 0
        ? [`### 文件内容: ${fileName}`, "", ...sections].join("\n\n")
        : buildMetadataMarkdown({
            name: fileName,
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size: buffer.byteLength,
          })
    );

    return {
      status: sections.length > 0 ? "success" : "skipped",
      progress: 100,
      parser: "text",
      markdown,
      error: sections.length > 0 ? undefined : "XLSX 无可解析工作表。",
    };
  } catch (error) {
    return {
      status: "error",
      progress: 100,
      parser: "metadata",
      markdown: buildMetadataMarkdown({
        name: fileName,
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: buffer.byteLength,
      }),
      error: error instanceof Error ? error.message : "XLSX 解析失败",
    };
  }
};

const decodeXmlEntities = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const parsePptxWithSystemParser = async ({
  fileName,
  buffer,
}: {
  fileName: string;
  buffer: Buffer;
}): Promise<FileParseInfo> => {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const slideEntries = Object.values(zip.files)
      .filter((entry) => !entry.dir && /ppt\/slides\/slide\d+\.xml$/i.test(entry.name))
      .sort((a, b) => {
        const aMatch = a.name.match(/slide(\d+)\.xml$/i);
        const bMatch = b.name.match(/slide(\d+)\.xml$/i);
        const aNo = aMatch ? Number(aMatch[1]) : 0;
        const bNo = bMatch ? Number(bMatch[1]) : 0;
        return aNo - bNo;
      });

    const sections: string[] = [];
    for (const entry of slideEntries) {
      const xml = await entry.async("string");
      const texts = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)).map((m) =>
        decodeXmlEntities((m[1] || "").trim())
      ).filter(Boolean);
      if (texts.length === 0) continue;

      const slideNo = entry.name.match(/slide(\d+)\.xml$/i)?.[1] || "?";
      sections.push(`#### Slide ${slideNo}\n\n${texts.join("\n")}`);
    }

    const markdown = truncateMarkdown(
      sections.length > 0
        ? [`### 文件内容: ${fileName}`, "", ...sections].join("\n\n")
        : buildMetadataMarkdown({
            name: fileName,
            type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            size: buffer.byteLength,
          })
    );

    return {
      status: sections.length > 0 ? "success" : "skipped",
      progress: 100,
      parser: "text",
      markdown,
      error: sections.length > 0 ? undefined : "PPTX 无可解析文本。",
    };
  } catch (error) {
    return {
      status: "error",
      progress: 100,
      parser: "metadata",
      markdown: buildMetadataMarkdown({
        name: fileName,
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size: buffer.byteLength,
      }),
      error: error instanceof Error ? error.message : "PPTX 解析失败",
    };
  }
};

const parseDocxWithSystemParser = async ({
  fileName,
  buffer,
}: {
  fileName: string;
  buffer: Buffer;
}): Promise<FileParseInfo> => {
  try {
    const mammoth = await import("mammoth");
    const turndown = (await import("turndown")).default;

    const htmlResult = await mammoth.convertToHtml(
      { buffer },
      {
        ignoreEmptyParagraphs: false,
      }
    );

    const service = new turndown();
    const mdBody = service.turndown(htmlResult.value || "").trim();
    const markdown = truncateMarkdown(
      mdBody
        ? [`### 文件内容: ${fileName}`, "", mdBody].join("\n")
        : buildMetadataMarkdown({
            name: fileName,
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: buffer.byteLength,
          })
    );

    return {
      status: mdBody ? "success" : "skipped",
      progress: 100,
      parser: "text",
      markdown,
      error: mdBody ? undefined : "DOCX 无可解析文本。",
    };
  } catch (error) {
    return {
      status: "error",
      progress: 100,
      parser: "metadata",
      markdown: buildMetadataMarkdown({
        name: fileName,
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: buffer.byteLength,
      }),
      error: error instanceof Error ? error.message : "DOCX 解析失败",
    };
  }
};

const parsePdfFromMinerUAsync = async ({
  fileName,
  extension,
  buffer,
  config,
}: {
  fileName: string;
  extension: string;
  buffer: Buffer;
  config: CustomPdfParseConfig;
}): Promise<FileParseInfo> => {
  const url = config.url;
  if (!url) {
    return {
      status: "skipped",
      progress: 100,
      parser: "metadata",
      markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
      error: "未配置 customPdfParse.url。",
    };
  }

  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {
    return {
      status: "error",
      progress: 100,
      parser: "customPdfParse",
      markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
      error: "MinerU url 配置不合法，请检查 customPdfParse.url",
    };
  }

  const authHeaders: Record<string, string> = {};
  if (config.key) {
    authHeaders.Authorization = `Bearer ${config.key}`;
  }

  const modelVersion = config.modelVersion || "vlm";

  try {
    const createTaskRes = await withTimeout(
      `${origin}/api/v4/file-urls/batch`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "*/*",
          ...authHeaders,
        },
        body: JSON.stringify({
          files: [{ name: `file.${extension}` }],
          model_version: modelVersion,
        }),
      },
      600000
    );

    const createTaskJson = (await createTaskRes.json().catch(() => ({}))) as {
      code?: number;
      msg?: string;
      data?: {
        batch_id?: string;
        file_urls?: string[];
      };
    };

    if (!createTaskRes.ok || createTaskJson.code !== 0) {
      return {
        status: "error",
        progress: 100,
        parser: "customPdfParse",
        markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
        error: `MinerU 申请上传 URL 失败：${createTaskJson.msg || createTaskRes.statusText || "unknown"}`,
      };
    }

    const batchId = createTaskJson.data?.batch_id;
    const uploadUrl = createTaskJson.data?.file_urls?.[0];
    if (!batchId || !uploadUrl) {
      return {
        status: "error",
        progress: 100,
        parser: "customPdfParse",
        markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
        error: "MinerU 返回数据缺少 batch_id / file_urls。",
      };
    }

    const uploadRes = await withTimeout(
      uploadUrl,
      {
        method: "PUT",
        headers: {},
        body: buffer,
      },
      600000
    );
    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => "");
      return {
        status: "error",
        progress: 100,
        parser: "customPdfParse",
        markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
        error: `MinerU 文件上传失败：${uploadRes.status} ${uploadRes.statusText}${text ? `，${text.slice(0, 300)}` : ""}`,
      };
    }

    const pollUrl = `${origin}/api/v4/extract-results/batch/${batchId}`;
    const timeoutMs = 10 * 60 * 1000;
    const intervalMs = 1500;
    const endAt = Date.now() + timeoutMs;

    let fullZipUrl = "";
    while (Date.now() < endAt) {
      const pollRes = await withTimeout(
        pollUrl,
        {
          method: "GET",
          headers: {
            Accept: "*/*",
            ...authHeaders,
          },
        },
        600000
      );

      const pollJson = (await pollRes.json().catch(() => ({}))) as {
        code?: number;
        msg?: string;
        data?: {
          extract_result?: Array<{
            state?: string;
            err_msg?: string;
            full_zip_url?: string;
          }>;
        };
      };

      if (!pollRes.ok || pollJson.code !== 0) {
        return {
          status: "error",
          progress: 100,
          parser: "customPdfParse",
          markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
          error: `MinerU 查询任务失败：${pollJson.msg || pollRes.statusText || "unknown"}`,
        };
      }

      const item = pollJson.data?.extract_result?.[0];
      const state = item?.state || "";

      if (state === "done") {
        fullZipUrl = item?.full_zip_url || "";
        break;
      }
      if (state === "failed") {
        return {
          status: "error",
          progress: 100,
          parser: "customPdfParse",
          markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
          error: `MinerU 解析失败：${item?.err_msg || "unknown"}`,
        };
      }

      await sleep(intervalMs);
    }

    if (!fullZipUrl) {
      return {
        status: "error",
        progress: 100,
        parser: "customPdfParse",
        markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
        error: "MinerU 解析超时：任务未在超时时间内完成。",
      };
    }

    const zipRes = await withTimeout(fullZipUrl, { method: "GET" }, 600000);
    if (!zipRes.ok) {
      const text = await zipRes.text().catch(() => "");
      return {
        status: "error",
        progress: 100,
        parser: "customPdfParse",
        markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
        error: `MinerU 下载解析结果失败：${zipRes.status} ${zipRes.statusText}${text ? `，${text.slice(0, 300)}` : ""}`,
      };
    }

    const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
    const zip = await JSZip.loadAsync(zipBuffer);

    const mdEntries = Object.values(zip.files).filter(
      (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".md")
    );

    if (mdEntries.length === 0) {
      return {
        status: "error",
        progress: 100,
        parser: "customPdfParse",
        markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
        error: "MinerU 解析结果中未找到 .md 文件。",
      };
    }

    const mdContents = await Promise.all(mdEntries.map((entry) => entry.async("string")));
    const markdown = mdContents.sort((a, b) => b.length - a.length)[0] || "";

    return {
      status: "success",
      progress: 100,
      parser: "customPdfParse",
      markdown: truncateMarkdown(markdown),
    };
  } catch (error) {
    return {
      status: "error",
      progress: 100,
      parser: "customPdfParse",
      markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
      error: error instanceof Error ? error.message : "MinerU async 解析失败",
    };
  }
};

const parsePdfFromCustomServiceSync = async ({
  fileName,
  buffer,
  config,
}: {
  fileName: string;
  buffer: Buffer;
  config: CustomPdfParseConfig;
}): Promise<FileParseInfo> => {
  if (!config.url) {
    return {
      status: "skipped",
      progress: 100,
      parser: "metadata",
      markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
      error: "未配置 customPdfParse.url。",
    };
  }

  try {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "application/pdf" }), fileName);

    const headers: Record<string, string> = {};
    if (config.key) {
      headers.Authorization = `Bearer ${config.key}`;
    }

    const response = await withTimeout(
      config.url,
      {
        method: "POST",
        headers,
        body: form,
      },
      600000
    );

    if (!response.ok) {
      return {
        status: "error",
        progress: 100,
        parser: "customPdfParse",
        markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
        error: `自定义 PDF 解析失败: HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => "");

    const markdown = extractMarkdownFromResponse(payload);
    if (!markdown.trim()) {
      return {
        status: "error",
        progress: 100,
        parser: "customPdfParse",
        markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
        error: "解析服务成功但未返回 markdown 字段。",
      };
    }

    return {
      status: "success",
      progress: 100,
      parser: "customPdfParse",
      markdown: truncateMarkdown(markdown),
    };
  } catch (error) {
    return {
      status: "error",
      progress: 100,
      parser: "customPdfParse",
      markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
      error: error instanceof Error ? error.message : "自定义 PDF 解析失败",
    };
  }
};

const parsePdfWithCustomParser = async ({
  fileName,
  buffer,
  config,
}: {
  fileName: string;
  buffer: Buffer;
  config: CustomPdfParseConfig;
}): Promise<FileParseInfo> => {
  if (!config.url) {
    return parsePdfWithSystemParser({ fileName, buffer });
  }

  const url = config.url || "";
  const mode = config.mode;
  const isMinerUExtractTask = url.includes("mineru.net") && url.includes("/api/v4/extract/task");

  if (isMinerUExtractTask && mode !== "sync") {
    const extension = path.extname(fileName).toLowerCase().replace(".", "") || "pdf";
    return parsePdfFromMinerUAsync({
      fileName,
      extension,
      buffer,
      config,
    });
  }

  if (mode === "async") {
    return {
      status: "error",
      progress: 100,
      parser: "customPdfParse",
      markdown: buildMetadataMarkdown({ name: fileName, type: "application/pdf", size: buffer.byteLength }),
      error: "customPdfParse.mode=async 目前仅支持 MinerU（mineru.net）",
    };
  }

  return parsePdfFromCustomServiceSync({
    fileName,
    buffer,
    config,
  });
};

export const parseFileToMarkdown = async ({
  fileName,
  type,
  buffer,
  pdfParserConfig,
}: {
  fileName: string;
  type: string;
  buffer: Buffer;
  pdfParserConfig: CustomPdfParseConfig;
}): Promise<FileParseInfo> => {
  const ext = path.extname(fileName).toLowerCase();

  if (ext === ".pdf" || type === "application/pdf") {
    return parsePdfWithCustomParser({ fileName, buffer, config: pdfParserConfig });
  }

  if (ext === ".docx") {
    return parseDocxWithSystemParser({ fileName, buffer });
  }

  if (ext === ".xlsx") {
    return parseXlsxWithSystemParser({ fileName, buffer });
  }

  if (ext === ".pptx") {
    return parsePptxWithSystemParser({ fileName, buffer });
  }

  if (ext === ".csv") {
    return parseCsvWithSystemParser({ fileName, buffer });
  }

  if (ext === ".html" || ext === ".htm") {
    return parseHtmlWithSystemParser({ fileName, buffer });
  }

  if (isImageFile(fileName, type)) {
    return {
      status: "skipped",
      progress: 100,
      parser: "metadata",
      markdown: buildMetadataMarkdown({
        name: fileName,
        type,
        size: buffer.byteLength,
      }),
      error: "图片文件不做文本解析，将走视觉理解。",
    };
  }

  if (isTextLikeFile(fileName, type)) {
    const content = buffer.toString("utf8");
    return {
      status: "success",
      progress: 100,
      parser: "text",
      markdown: truncateMarkdown(formatTextMarkdown({ fileName, content })),
    };
  }

  return {
    status: "skipped",
    progress: 100,
    parser: "metadata",
    markdown: buildMetadataMarkdown({
      name: fileName,
      type,
      size: buffer.byteLength,
    }),
  };
};
