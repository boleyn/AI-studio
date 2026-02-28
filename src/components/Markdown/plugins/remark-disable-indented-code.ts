import { visit } from 'unist-util-visit';

// 通过 AST 规则改变：将“缩进代码块”（无语言标识的 code 节点）
// 在满足一定启发式条件时，降级为普通段落，从而避免被渲染成代码块。
// 注意：不影响 ```fenced``` 代码块和带语言的代码块。

export function remarkDisableIndentedCode() {
  return (tree: any, file: any) => {
    const original = String(file);
    const lines = original.split(/\r?\n/);

    visit(tree, 'code', (node: any, index: number | undefined, parent: any) => {
      if (!parent || index === undefined) return;

      const value: string = typeof node.value === 'string' ? node.value : '';

      // 若是 fenced 代码块（``` 或 ~~~ 包裹），跳过
      const startLineIdx = node.position?.start?.line ? node.position.start.line - 1 : null;
      const endLineIdx = node.position?.end?.line ? node.position.end.line - 1 : null;
      let isFenced = false;
      if (startLineIdx !== null) {
        const openLineIdx = startLineIdx - 1;
        if (openLineIdx >= 0) {
          const openLine = lines[openLineIdx] ?? '';
          if (/^\s*([`~]{3,})/.test(openLine)) {
            isFenced = true;
          }
        }
      }
      if (!isFenced && endLineIdx !== null) {
        const closeLineIdx = endLineIdx + 1;
        if (closeLineIdx < lines.length) {
          const closeLine = lines[closeLineIdx] ?? '';
          if (/^\s*([`~]{3,})\s*$/.test(closeLine)) {
            isFenced = true;
          }
        }
      }
      if (isFenced) return;

      // 判断是否真的是缩进代码块（原文相应行以 4+ 空格或 tab 开头）
      let looksIndented = false;
      if (startLineIdx !== null && endLineIdx !== null) {
        for (let i = startLineIdx; i <= endLineIdx; i++) {
          const l = lines[i] ?? '';
          if (/^( {4,}|\t+)/.test(l)) {
            looksIndented = true;
            break;
          }
        }
      }
      if (!looksIndented) return;

      // 启发式：更像普通文本而非代码时，降级为段落
      const looksLikeNormalText =
        /[\u4e00-\u9fa5A-Za-z]/.test(value) || /[，。！？；：、,.!?;:]/.test(value);
      const looksLikeCode = /[{}`;<>]|function|class|\bif\b|\bfor\b|\bconst\b|\blet\b|\bvar\b/.test(
        value
      );
      const isMultiLine = value.includes('\n');

      if ((looksLikeNormalText && !looksLikeCode) || (!isMultiLine && !looksLikeCode)) {
        parent.children[index] = {
          type: 'paragraph',
          children: [{ type: 'text', value }]
        };
      }
    });
  };
}

export default remarkDisableIndentedCode;
