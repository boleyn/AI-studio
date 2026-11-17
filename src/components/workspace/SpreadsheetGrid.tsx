import { Box, Button, Flex, Input, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";

export type PreviewSheet = {
  name: string;
  rowCount: number;
  columnCount: number;
  firstRow: number;
  firstColumn: number;
  cells: Record<string, { value: string; formula?: string }>;
};

function spreadsheetColumnLabel(index: number) {
  let label = "";
  for (let column = index + 1; column > 0; column = Math.floor((column - 1) / 26)) {
    label = String.fromCharCode(65 + ((column - 1) % 26)) + label;
  }
  return label;
}

const spreadsheetRowsPerPage = 100;
const spreadsheetColumnsPerPage = 24;

export default function SpreadsheetGrid({ sheet, zoom, onSelectCell }: {
  sheet: PreviewSheet;
  zoom: number;
  onSelectCell?: (sheet: string, address: string) => void;
}) {
  const { rowCount, columnCount, firstRow, firstColumn, cells } = sheet;
  const [activeCell, setActiveCell] = useState({ row: 0, column: 0 });
  const [addressDraft, setAddressDraft] = useState<string>();
  const [addressError, setAddressError] = useState(false);
  const [selectionStart, setSelectionStart] = useState<typeof activeCell>();
  const gridRef = useRef<HTMLTableElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowStart = Math.floor(activeCell.row / spreadsheetRowsPerPage) * spreadsheetRowsPerPage;
  const columnStart = Math.floor(activeCell.column / spreadsheetColumnsPerPage) * spreadsheetColumnsPerPage;
  const rowEnd = Math.min(rowStart + spreadsheetRowsPerPage, rowCount);
  const columnEnd = Math.min(columnStart + spreadsheetColumnsPerPage, columnCount);
  const rows = Array.from({ length: rowEnd - rowStart }, (_, index) => rowStart + index);
  const columns = Array.from({ length: columnEnd - columnStart }, (_, index) => columnStart + index);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [rowStart, columnStart]);

  const addressOf = ({ row, column }: typeof activeCell) =>
    spreadsheetColumnLabel(firstColumn + column) + (firstRow + row + 1);
  const activeAddress = addressOf(activeCell);
  const selectedCell = cells[activeAddress];
  const anchor = selectionStart ?? activeCell;
  const top = Math.min(anchor.row, activeCell.row);
  const bottom = Math.max(anchor.row, activeCell.row);
  const left = Math.min(anchor.column, activeCell.column);
  const right = Math.max(anchor.column, activeCell.column);
  const selectedAddress = top === bottom && left === right
    ? activeAddress
    : `${addressOf({ row: top, column: left })}:${addressOf({ row: bottom, column: right })}`;
  const selectCell = (cell: typeof activeCell, extend: boolean) => {
    setSelectionStart(extend ? (previous) => previous ?? activeCell : undefined);
    setActiveCell(cell);
  };

  const focusCell = (cell: typeof activeCell) => {
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${cell.row}:${cell.column}"]`)?.focus();
    });
  };
  const parseAddress = (input: string) => {
    const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})$/i.exec(input.trim());
    if (!match) return undefined;
    const absoluteColumn = [...match[1].toUpperCase()]
      .reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
    const cell = { row: Number(match[2]) - firstRow - 1, column: absoluteColumn - firstColumn };
    return cell.row >= 0 && cell.row < rowCount && cell.column >= 0 && cell.column < columnCount ? cell : undefined;
  };
  const jumpToAddress = () => {
    const entries = (addressDraft ?? selectedAddress).split(":");
    const start = parseAddress(entries[0]);
    const end = entries.length === 2 ? parseAddress(entries[1]) : undefined;
    if (!start || entries.length > 2 || (entries.length === 2 && !end)) {
      setAddressError(true);
      return;
    }
    setAddressDraft(undefined);
    setAddressError(false);
    setSelectionStart(end ? start : undefined);
    setActiveCell(end ?? start);
    focusCell(end ?? start);
  };

  if (!rowCount || !columnCount) return <Text p={4} fontSize="sm">此工作表没有可预览的数据</Text>;

  return (
    <>
      {onSelectCell && (
        <Flex px={3} py={2} align="center" gap={2} justify="space-between" wrap="wrap">
          <Text fontSize="sm">选中单元格，按 Shift 扩展选区</Text>
          <Button size="sm" onClick={() => onSelectCell(sheet.name, selectedAddress)}>修改 {selectedAddress}</Button>
        </Flex>
      )}
      <Flex align="center" borderBottom="1px solid" borderColor="gray.200" minH="34px" fontSize="xs">
        <Input size="xs" aria-label="单元格地址或范围" value={addressDraft ?? selectedAddress}
          w={selectedAddress.includes(":") ? "115px" : "74px"} px={3} border={0} borderRadius={0}
          isInvalid={addressError} onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => { setAddressDraft(event.target.value); setAddressError(false); }}
          onBlur={() => { setAddressDraft(undefined); setAddressError(false); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              jumpToAddress();
            }
          }} />
        <Box
          as="input"
          aria-label="单元格内容"
          readOnly
          value={selectedCell?.formula ?? selectedCell?.value ?? ""}
          flex="1"
          minW={0}
          px={3}
          alignSelf="stretch"
          borderLeft="1px solid"
          borderColor="gray.200"
        />
      </Flex>
      {addressError && <Text px={3} py={1} fontSize="xs" color="red.600" role="alert">请输入工作表范围内的单元格地址。</Text>}
      <Box ref={scrollRef} flex="1" minH={0} overflow="auto">
        <Box as="table" ref={gridRef} fontSize="xs" minW="100%"
          sx={{
            borderSpacing: 0,
            zoom: zoom / 100,
            "th, td": { borderRight: "1px solid", borderBottom: "1px solid", borderColor: "gray.200" },
            th: { bg: "gray.50", color: "gray.600", fontWeight: "normal" },
            "thead th": { position: "sticky", top: 0, zIndex: 2, height: "24px" },
            "tr > th:first-child": { position: "sticky", left: 0, minWidth: "42px", zIndex: 1 },
            "thead th:first-child": { zIndex: 3 },
          }}
        >
          <thead>
            <tr>
              <th aria-label="行号" />
              {columns.map((column) => (
                <th scope="col" key={column}>{spreadsheetColumnLabel(firstColumn + column)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((rowIndex) => (
              <tr key={rowIndex}>
                <th scope="row">{firstRow + rowIndex + 1}</th>
                {columns.map((column) => {
                  const address = addressOf({ row: rowIndex, column });
                  const value = cells[address]?.value ?? "";
                  return <td key={column}>
                    <Box
                      as="button"
                      type="button"
                      tabIndex={activeCell.row === rowIndex && activeCell.column === column ? 0 : -1}
                      data-cell={`${rowIndex}:${column}`}
                      onKeyDown={(event) => {
                        const direction = {
                          ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
                        }[event.key];
                        if (!direction) return;
                        event.preventDefault();
                        const row = Math.max(0, Math.min(rowCount - 1, rowIndex + direction[0]));
                        const nextColumn = Math.max(0, Math.min(columnCount - 1, column + direction[1]));
                        selectCell({ row, column: nextColumn }, event.shiftKey);
                        focusCell({ row, column: nextColumn });
                      }}
                      aria-label={`${address} ${value}`.trim()}
                      onClick={(event) => selectCell({ row: rowIndex, column }, event.shiftKey)}
                      bg={rowIndex >= top && rowIndex <= bottom && column >= left && column <= right ? "blue.50" : undefined}
                      textAlign="left"
                      px={2}
                      minW="88px"
                      minH="26px"
                      w="100%"
                      whiteSpace="pre-wrap"
                      boxShadow={activeCell.row === rowIndex && activeCell.column === column ? "inset 0 0 0 2px #2563eb" : undefined}
                    >
                      {value}
                    </Box>
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </Box>
      </Box>
      {(rowCount > spreadsheetRowsPerPage || columnCount > spreadsheetColumnsPerPage) && (
        <Flex px={2} py={1} gap={1} align="center" wrap="wrap" borderTop="1px solid" borderColor="gray.200">
          <Text fontSize="xs" color="gray.600" flex={1}>
            {addressOf({ row: rowStart, column: columnStart })}–{addressOf({ row: rowEnd - 1, column: columnEnd - 1 })}
          </Text>
          {rowCount > spreadsheetRowsPerPage && <>
            <Button size="xs" variant="ghost" isDisabled={rowStart === 0}
              onClick={() => selectCell({ row: rowStart - spreadsheetRowsPerPage, column: activeCell.column }, false)}>上一组行</Button>
            <Button size="xs" variant="ghost" isDisabled={rowEnd === rowCount}
              onClick={() => selectCell({ row: rowEnd, column: activeCell.column }, false)}>下一组行</Button>
          </>}
          {columnCount > spreadsheetColumnsPerPage && <>
            <Button size="xs" variant="ghost" isDisabled={columnStart === 0}
              onClick={() => selectCell({ row: activeCell.row, column: columnStart - spreadsheetColumnsPerPage }, false)}>上一组列</Button>
            <Button size="xs" variant="ghost" isDisabled={columnEnd === columnCount}
              onClick={() => selectCell({ row: activeCell.row, column: columnEnd }, false)}>下一组列</Button>
          </>}
        </Flex>
      )}
    </>
  );
}
