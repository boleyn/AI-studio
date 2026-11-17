import type { PreviewSheet } from "./SpreadsheetGrid";
import type { SpreadsheetWorkerResult } from "./spreadsheetWorker";

export async function loadSpreadsheet(buffer: ArrayBuffer, signal: AbortSignal): Promise<PreviewSheet[]> {
  signal.throwIfAborted();
  let worker: Worker;
  try {
    worker = new Worker(new URL("./spreadsheetWorker.ts", import.meta.url));
  } catch {
    const { parseSpreadsheet } = await import("./parseSpreadsheet");
    signal.throwIfAborted();
    return parseSpreadsheet(buffer);
  }

  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<PreviewSheet[]>((resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      worker.onmessage = ({ data }: MessageEvent<SpreadsheetWorkerResult>) => {
        if ("sheets" in data) resolve(data.sheets);
        else reject(new Error(data.error));
      };
      worker.onerror = () => reject(new Error("无法启动表格解析器"));
      worker.onmessageerror = () => reject(new Error("无法读取表格解析结果"));
      worker.postMessage(buffer, [buffer]);
    });
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    worker.terminate();
  }
}
