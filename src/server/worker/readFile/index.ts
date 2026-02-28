import JSZip from "jszip";

export type ReadFileResponse = {
  rawText: string;
  formatText?: string;
};

const CUSTOM_SPLIT_SIGN = "\n\n------\n\n";

const decodeXmlEntities = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

type PdfToken = {
  str: string;
  transform?: number[];
  hasEOL?: boolean;
};

const readPdf = async (buffer: Buffer): Promise<ReadFileResponse> => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");

  const uint8Array = new Uint8Array(buffer.byteLength);
  uint8Array.set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));

  const loadingTask = pdfjs.getDocument({ data: uint8Array });
  const doc = await loadingTask.promise;

  const readPageText = async (pageNo: number): Promise<string> => {
    try {
      const page = await doc.getPage(pageNo);
      const tokenizedText = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const pageHeight = viewport.height;
      const headerThreshold = pageHeight * 0.95;
      const footerThreshold = pageHeight * 0.05;

      const pageTexts = (tokenizedText.items as PdfToken[]).filter((token) => {
        if (!token.transform) return true;
        const y = token.transform[5];
        return y < headerThreshold && y > footerThreshold;
      });

      for (let i = 0; i < pageTexts.length; i += 1) {
        const item = pageTexts[i];
        if (item.str === "" && pageTexts[i - 1]) {
          pageTexts[i - 1].hasEOL = item.hasEOL;
          pageTexts.splice(i, 1);
          i -= 1;
        }
      }

      page.cleanup();

      return pageTexts
        .map((token) => {
          const paragraphEnd = token.hasEOL && /([。？！.?!\n\r]|(\r\n))$/.test(token.str);
          return paragraphEnd ? `${token.str}\n` : token.str;
        })
        .join("");
    } catch {
      return "";
    }
  };

  const pageArr = Array.from({ length: doc.numPages }, (_, i) => i + 1);
  const rawText = (await Promise.all(pageArr.map((page) => readPageText(page)))).join("");
  loadingTask.destroy();

  return { rawText };
};

const readDocx = async (buffer: Buffer): Promise<ReadFileResponse> => {
  const mammoth = await import("mammoth");
  const turndown = (await import("turndown")).default;

  const htmlResult = await mammoth.convertToHtml(
    { buffer },
    {
      ignoreEmptyParagraphs: false,
    }
  );

  const service = new turndown();
  const markdown = service.turndown(htmlResult.value || "").trim();

  return {
    rawText: markdown,
    formatText: markdown,
  };
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

const readCsv = async (buffer: Buffer): Promise<ReadFileResponse> => {
  const Papa = (await import("papaparse")).default;
  const raw = buffer.toString("utf8");
  const csvRows = (Papa.parse<string[]>(raw).data || []).map((row) =>
    Array.isArray(row) ? row.map((item) => String(item ?? "")) : []
  );
  const table = toMarkdownTable(csvRows);

  return {
    rawText: raw,
    formatText: table,
  };
};

const readXlsx = async (buffer: Buffer): Promise<ReadFileResponse> => {
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

  return {
    rawText: sections.join(CUSTOM_SPLIT_SIGN),
    formatText: sections.join(CUSTOM_SPLIT_SIGN),
  };
};

const readPptx = async (buffer: Buffer): Promise<ReadFileResponse> => {
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
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi))
      .map((m) => decodeXmlEntities((m[1] || "").trim()))
      .filter(Boolean);
    if (texts.length === 0) continue;

    const slideNo = entry.name.match(/slide(\d+)\.xml$/i)?.[1] || "?";
    sections.push(`#### Slide ${slideNo}\n\n${texts.join("\n")}`);
  }

  const text = sections.join(CUSTOM_SPLIT_SIGN);
  return {
    rawText: text,
    formatText: text,
  };
};

const readHtml = async (buffer: Buffer): Promise<ReadFileResponse> => {
  const html = buffer.toString("utf8");
  const turndown = (await import("turndown")).default;
  const service = new turndown();
  const markdown = service.turndown(html).trim();
  return {
    rawText: markdown,
    formatText: markdown,
  };
};

const readText = (buffer: Buffer, encoding: string): ReadFileResponse => {
  try {
    const rawText = buffer.toString((encoding || "utf8") as BufferEncoding);
    return { rawText };
  } catch {
    return { rawText: buffer.toString("utf8") };
  }
};

export const readRawContentFromBuffer = async ({
  extension,
  encoding,
  buffer,
}: {
  extension: string;
  encoding: string;
  buffer: Buffer;
}): Promise<ReadFileResponse> => {
  switch (extension.toLowerCase()) {
    case "txt":
    case "md":
    case "json":
    case "js":
    case "ts":
    case "tsx":
    case "jsx":
    case "py":
    case "java":
    case "go":
    case "rs":
    case "css":
    case "xml":
    case "yml":
    case "yaml":
    case "log":
      return readText(buffer, encoding);
    case "html":
    case "htm":
      return readHtml(buffer);
    case "pdf":
      return readPdf(buffer);
    case "docx":
      return readDocx(buffer);
    case "pptx":
      return readPptx(buffer);
    case "xlsx":
      return readXlsx(buffer);
    case "csv":
      return readCsv(buffer);
    default:
      return readText(buffer, encoding);
  }
};
