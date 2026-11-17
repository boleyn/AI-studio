import { read, utils } from "xlsx";
import type { PreviewSheet } from "./SpreadsheetGrid";

export function parseSpreadsheet(buffer: ArrayBuffer): PreviewSheet[] {
  const workbook = read(buffer, { type: "array" });
  return workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const range = worksheet["!ref"] ? utils.decode_range(worksheet["!ref"]) : undefined;
    const cells: PreviewSheet["cells"] = {};
    for (const [address, cell] of Object.entries(worksheet)) {
      if (address.startsWith("!") || !cell) continue;
      cells[address] = {
        value: utils.format_cell(cell),
        ...(cell.f ? { formula: `=${cell.f}` } : {}),
      };
    }
    return {
      name,
      cells,
      firstRow: range?.s.r ?? 0,
      firstColumn: range?.s.c ?? 0,
      rowCount: range ? range.e.r - range.s.r + 1 : 0,
      columnCount: range ? range.e.c - range.s.c + 1 : 0,
    };
  });
}
