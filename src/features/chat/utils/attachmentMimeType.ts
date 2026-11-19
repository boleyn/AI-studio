const byExtension = new Map(Object.entries({
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  pdf: "application/pdf",
  json: "application/json",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
}));

export function inferAttachmentMimeType(path: string, fallbackPath?: string): string {
  const extension = /\.([^.\\/]+)$/.exec(path)?.[1].toLowerCase();
  const type = extension && byExtension.get(extension);
  if (type) return type;
  return fallbackPath ? inferAttachmentMimeType(fallbackPath) : "application/octet-stream";
}
