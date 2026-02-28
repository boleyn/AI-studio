/**
 * SQLBot 代码块渲染组件
 *
 * 用于渲染 Markdown 中的 ```sqlBot 代码块
 * 代码块内容为 SQLBot 返回的 JSON 数据，格式如：
 * ```sqlBot
 * {"success":true,"record_id":123,"sql":"...","data":[...],"chart":{...}}
 * ```
 *
 * 此组件会将 SQLBot JSON 转换为 Codechart 格式，然后渲染图表
 */

import React, { useMemo, useContext, useEffect, useState } from 'react';
import { Box, Skeleton } from '@chakra-ui/react';
import dynamic from 'next/dynamic';
import { MarkdownCtx } from '../context';
import { type Codechart } from '@/features/dashboard/charts/utils';

// 动态导入 EChartsRender 组件
const EChartsRender = dynamic(() => import('@/features/dashboard/components/EChartsRender'), {
  ssr: false,
  loading: () => <Skeleton h="300px" w="100%" borderRadius="md" />
});

// ========== SQLBot 数据格式类型定义 ==========
interface SQLBotData {
  success: boolean;
  record_id: number;
  title?: string;
  sql: string;
  data: Array<Record<string, any>>;
  chart: {
    type: string;
    title?: string;
    axis?: {
      x: {
        name: string;
        value: string;
      };
      y:
        | {
            name: string;
            value: string;
          }
        | Array<{
            name: string;
            value: string;
          }>;
      series?: {
        name: string;
        value: string;
      };
    };
    columns?: Array<{
      name: string;
      value: string;
    }>;
  };
}

// 默认色板（10色）
const DEFAULT_PALETTE = [
  '#5470c6',
  '#91cc75',
  '#fac858',
  '#ee6666',
  '#73c0de',
  '#3ba272',
  '#fc8452',
  '#9a60b4',
  '#ea7ccc',
  '#1f77b4'
];

// 图表类型映射
const CHART_TYPE_MAP: Record<string, string> = {
  column: 'bar',
  bar: 'bar-horizontal',
  line: 'line',
  pie: 'pie',
  scatter: 'line',
  table: 'table',
  funnel: 'funnel',
  number: 'number'
};

/**
 * 检测是否为 SQLBot 格式
 */
function isSQLBotFormat(data: any): data is SQLBotData {
  return (
    data &&
    typeof data === 'object' &&
    typeof data.record_id === 'number' &&
    data.success === true &&
    data.chart &&
    typeof data.chart === 'object'
  );
}

/**
 * 映射图表类型
 */
function mapChartType(sqlbotType: string): string {
  return CHART_TYPE_MAP[sqlbotType] || 'bar';
}

/**
 * 处理特殊值
 */
function sanitizeValue(value: any, isNumeric: boolean = false): any {
  if (value === null || value === undefined) {
    return isNumeric ? 0 : '';
  }
  return isNumeric ? Number(value) || 0 : String(value);
}

/**
 * 基于整列值推断是否是数值列（用于表格）
 */
function inferIsNumericColumnForTable(data: Array<Record<string, any>>, field: string): boolean {
  let sawValue = false;
  for (const row of data) {
    const v = row[field];
    if (v === null || v === undefined || String(v).trim() === '') continue;
    sawValue = true;
    // 包含百分号或千分位逗号的，按字符串处理
    const s = String(v).trim();
    if (s.includes('%') || s.includes(',')) return false;
    const n = Number(s);
    if (!Number.isFinite(n)) return false;
  }
  return sawValue;
}

/**
 * 将 SQLBot 数据转换为 Codechart 格式
 */
function convertSQLBotToCodechart(
  parsed: SQLBotData
): { codechart: Codechart; sql: string } | null {
  const { sql, data, chart, title } = parsed;

  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  // 处理 table 类型
  if (chart.type === 'table') {
    if (!chart.columns || !Array.isArray(chart.columns) || chart.columns.length === 0) {
      return null;
    }

    const columns = chart.columns;
    const dimensionField = columns[0].value;
    const metricFields = columns.slice(1).map((c) => c.value);
    const numericFieldMap: Record<string, boolean> = {};
    metricFields.forEach((field) => {
      numericFieldMap[field] = inferIsNumericColumnForTable(data, field);
    });

    const metrics = columns.slice(1).map((col) => col.name);
    const rows = data.map((row) => {
      const dim = String(row[dimensionField] ?? '');
      const values = metricFields.map((field) => {
        const raw = row[field];
        const isNum = numericFieldMap[field];
        return isNum ? Number(raw) || 0 : String(raw ?? '');
      });
      return [dim, ...values] as [string, ...Array<number | string>];
    });

    return {
      codechart: {
        title: chart.title || title || '数据表格',
        metrics,
        rows,
        chartType: 'table' as any,
        palette: DEFAULT_PALETTE,
        dimensionName: columns[0]?.name
      },
      sql
    };
  }

  // 非表格类型需要 axis 配置
  if (!chart.axis || !chart.axis.y) {
    return null;
  }

  // 饼图处理：优先 axis.x，其次 axis.series
  let xField: string | undefined;
  if (chart.type === 'pie') {
    xField = chart.axis.x?.value || (chart.axis as any).series?.value;
    if (!xField) return null;
  } else {
    if (!chart.axis.x) return null;
    xField = chart.axis.x.value;
  }

  const yConfig = chart.axis.y;

  // 多指标支持：当 axis.y 是数组时
  if (Array.isArray(yConfig) && yConfig.length > 0) {
    const yFields = yConfig.map((c: any) => c?.value).filter(Boolean);
    if (!xField || yFields.length === 0) return null;

    const rows = data.map((row) => {
      const dim = sanitizeValue(row[xField!], false);
      const values = yFields.map((f: string) => sanitizeValue(row[f], true));
      return [dim, ...values] as [string, ...number[]];
    });

    return {
      codechart: {
        title: chart.title || title || '查询结果',
        metrics: yConfig.map((c: any) => String(c?.name || '').trim()).filter((s: string) => s),
        rows,
        chartType: mapChartType(chart.type) as any,
        palette: DEFAULT_PALETTE
      },
      sql
    };
  }

  // 单指标处理
  const yField = (yConfig as any).value;
  if (!xField || !yField) {
    return null;
  }

  const rows = data.map((row) => {
    const xValue = sanitizeValue(row[xField!], false);
    const yValue = sanitizeValue(row[yField], true);
    return [xValue, yValue] as [string, number];
  });

  return {
    codechart: {
      title: chart.title || title || '查询结果',
      metrics: [(yConfig as any).name],
      rows,
      chartType: mapChartType(chart.type) as any,
      palette: DEFAULT_PALETTE
    },
    sql
  };
}

interface SQLBotCodeBlockProps {
  code: string;
}

const SQLBotCodeBlock: React.FC<SQLBotCodeBlockProps> = ({ code }) => {
  const { showAnimation } = useContext(MarkdownCtx);

  // 解析并转换 SQLBot JSON
  const [chartResult, setChartResult] = useState<{ codechart: Codechart; sql: string } | null>(
    null
  );

  useEffect(() => {
    if (!code || typeof code !== 'string') {
      if (!showAnimation) {
        setChartResult(null);
      }
      return;
    }

    const extractJson = (input: string) => {
      const start = input.indexOf('{');
      if (start === -1) return input;
      let braceCount = 0;
      for (let i = start; i < input.length; i++) {
        const char = input[i];
        if (char === '{') braceCount++;
        if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            return input.slice(start, i + 1);
          }
        }
      }
      return input;
    };

    try {
      const trimmedCode = code.trim();
      const jsonStr = extractJson(trimmedCode);
      const parsed = JSON.parse(jsonStr);

      if (!isSQLBotFormat(parsed)) {
        if (!showAnimation) {
          console.warn('[SQLBotCodeBlock] Not a valid SQLBot format');
          setChartResult(null);
        }
        return;
      }

      const result = convertSQLBotToCodechart(parsed);
      if (!result) {
        if (!showAnimation) {
          console.warn('[SQLBotCodeBlock] Failed to convert SQLBot to Codechart');
          setChartResult(null);
        }
        return;
      }

      setChartResult(result);
    } catch (err) {
      // 流式输出时保留上一次成功结果，避免闪烁
      if (!showAnimation) {
        console.warn('[SQLBotCodeBlock] JSON parse error:', err);
        setChartResult(null);
      }
    }
  }, [code, showAnimation]);

  // 如果正在流式输出且没有有效数据，显示加载骨架
  if (showAnimation && !chartResult) {
    return (
      <Box w="100%" minH="200px" p={4}>
        <Skeleton h="200px" w="100%" borderRadius="md" />
      </Box>
    );
  }

  // 如果没有有效数据，不渲染
  if (!chartResult) {
    return null;
  }

  const { codechart, sql } = chartResult;
  // 添加到仪表板的事件处理
  const handleAdd = () => {
    const evt = new CustomEvent('fg-add-chart', {
      detail: {
        codechart,
        sql,
        type: codechart.chartType
      }
    });
    window.dispatchEvent(evt);
  };

  // Chat 对话中使用完整版本渲染
  return (
    <Box
      mt={3}
      w="clamp(250px, calc(100cqw - 72px), 1200px)"
      sx={{
        '@supports not (width: 1cqw)': {
          width: 'clamp(250px, 600px, 800px)'
        }
      }}
    >
      <EChartsRender mode="chat" codechart={codechart} sql={sql} onAdd={handleAdd} />
    </Box>
  );
};

export default React.memo(SQLBotCodeBlock);
