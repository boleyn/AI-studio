import React, { useRef, useCallback } from 'react';
import { Box } from '@chakra-ui/react';
import Icon from '@/components/common/MyIcon';
import MyTooltip from '@/components/common/MyTooltip';
import { useCopyData } from '@/hooks/useCopyData';

interface TableProps {
  children: React.ReactNode;
  className?: string;
  [key: string]: any;
}

const Table = ({ children, className, ...props }: TableProps) => {
  const { copyData } = useCopyData();
  const tableRef = useRef<HTMLTableElement>(null);

  // 提取表格数据为 CSV 格式（用于下载）
  const extractTableDataCSV = useCallback(() => {
    if (!tableRef.current) return '';

    const rows = tableRef.current.querySelectorAll('tr');
    if (rows.length === 0) return '';

    const csvRows: string[] = [];

    rows.forEach((row) => {
      const cells = row.querySelectorAll('th, td');
      const cellTexts: string[] = [];

      cells.forEach((cell) => {
        const text = (cell.textContent || '').trim();
        // 处理包含逗号或引号的单元格，用引号包裹
        if (text.includes(',') || text.includes('"') || text.includes('\n')) {
          cellTexts.push(`"${text.replace(/"/g, '""')}"`);
        } else {
          cellTexts.push(text);
        }
      });

      if (cellTexts.length > 0) {
        csvRows.push(cellTexts.join(','));
      }
    });

    return csvRows.join('\n');
  }, []);

  // 提取表格数据为 Markdown 格式（用于复制）
  const extractTableDataMarkdown = useCallback(() => {
    if (!tableRef.current) return '';

    const rows = tableRef.current.querySelectorAll('tr');
    if (rows.length === 0) return '';

    const mdRows: string[] = [];
    let isFirstRow = true;

    rows.forEach((row) => {
      const cells = row.querySelectorAll('th, td');
      const cellTexts: string[] = [];

      cells.forEach((cell) => {
        // 转义 Markdown 表格中的特殊字符 |
        const text = (cell.textContent || '').trim().replace(/\|/g, '\\|');
        cellTexts.push(text);
      });

      if (cellTexts.length > 0) {
        mdRows.push(`| ${cellTexts.join(' | ')} |`);

        // 在表头后添加分隔行
        if (isFirstRow) {
          mdRows.push(`| ${cellTexts.map(() => '---').join(' | ')} |`);
          isFirstRow = false;
        }
      }
    });

    return mdRows.join('\n');
  }, []);

  const handleCopy = useCallback(() => {
    const data = extractTableDataMarkdown();
    if (data) {
      copyData(data);
    }
  }, [extractTableDataMarkdown, copyData]);

  const handleDownload = useCallback(() => {
    const data = extractTableDataCSV();
    if (!data) return;

    const blob = new Blob(['\ufeff' + data], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `table-${Date.now()}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }, [extractTableDataCSV]);

  return (
    <Box position={'relative'} my={4} className="table-wrapper">
      <Box position={'absolute'} top={'-36px'} right={0} zIndex={10} display={'flex'} gap={1}>
        <MyTooltip label={'复制'}>
          <Box
            cursor={'pointer'}
            onClick={handleCopy}
            bg={'white'}
            border={'1px solid'}
            borderColor={'gray.200'}
            p={2}
            borderRadius={'md'}
            _hover={{ bg: 'gray.50' }}
          >
            <Icon name={'copy'} w={'16px'} h={'16px'} />
          </Box>
        </MyTooltip>
        <MyTooltip label="下载 CSV">
          <Box
            cursor={'pointer'}
            onClick={handleDownload}
            bg={'white'}
            border={'1px solid'}
            borderColor={'gray.200'}
            p={2}
            borderRadius={'md'}
            _hover={{ bg: 'gray.50' }}
          >
            <Icon name={'common/download'} w={'16px'} h={'16px'} />
          </Box>
        </MyTooltip>
      </Box>
      <Box overflowX={'auto'} maxW={'100%'} style={{ WebkitOverflowScrolling: 'touch' }}>
        {React.createElement(
          'table',
          {
            ref: tableRef,
            className,
            ...props,
            style: {
              ...(props?.style || {}),
              minWidth: 'max-content',
              tableLayout: 'auto'
            }
          },
          children
        )}
      </Box>
    </Box>
  );
};

export default React.memo(Table);
