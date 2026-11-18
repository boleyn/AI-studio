const byExtension = new Map(Object.entries({
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  pdf: "application/pdf",
  json: "application/json",
  csv: "text/csv",
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
