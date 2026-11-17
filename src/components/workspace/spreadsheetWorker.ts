/// <reference lib="webworker" />
import { parseSpreadsheet } from "./parseSpreadsheet";
import type { PreviewSheet } from "./SpreadsheetGrid";

export type SpreadsheetWorkerResult = { sheets: PreviewSheet[] } | { error: string };
const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
  let result: SpreadsheetWorkerResult;
  try {
    result = { sheets: parseSpreadsheet(data) };
  } catch (error) {
    result = { error: error instanceof Error ? error.message : "无法解析工作簿" };
  }
  worker.postMessage(result);
};
