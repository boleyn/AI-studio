import mermaid from 'mermaid';

let mermaidInitialized = false;

/**
 * 初始化 mermaid，保持各处渲染一致（白底 + 关闭 startOnLoad）
 */
export function ensureMermaidInitialized() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    flowchart: { useMaxWidth: false, htmlLabels: true },
    sequence: { useMaxWidth: false },
    er: { useMaxWidth: false },
    themeVariables: {
      background: '#ffffff',
      primaryColor: '#d6e8ff',
      primaryTextColor: '#485058',
      primaryBorderColor: '#7a8b9a',
      lineColor: '#5A646E',
      secondaryColor: '#B5E9E5',
      tertiaryColor: '#485058'
    }
  });
  mermaidInitialized = true;
}

/**
 * 解析 SVG 字符串的尺寸
 */
export function parseSvgSize(svgStr: string): { width: number; height: number } {
  const viewBoxMatch = svgStr.match(
    /viewBox="(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/i
  );
  if (viewBoxMatch) {
    const w = parseFloat(viewBoxMatch[3]);
    const h = parseFloat(viewBoxMatch[4]);
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  const widthMatch = svgStr.match(/width="(\d+(?:\.\d+)?)(px)?"/i);
  const heightMatch = svgStr.match(/height="(\d+(?:\.\d+)?)(px)?"/i);
  const width = widthMatch ? parseFloat(widthMatch[1]) : 1024;
  const height = heightMatch ? parseFloat(heightMatch[1]) : 768;
  return { width, height };
}

/**
 * 下载 Blob 文件
 */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 导出 SVG 为 JPG 图片（高分辨率）
 * @param svgContent SVG 字符串内容
 * @param filename 文件名（不含扩展名）
 */
export function exportSvgToJpg(svgContent: string, filename: string = 'diagram') {
  if (!svgContent) return;

  const fallback = parseSvgSize(svgContent);
  // 固定缩放因子，避免不同设备 DPR 导致清晰度不一致
  const scale = 3;
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    // 优先使用图片加载后的实际尺寸，回退到解析的尺寸
    const naturalW = img.naturalWidth || fallback.width;
    const naturalH = img.naturalHeight || fallback.height;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(naturalW * scale));
    canvas.height = Math.max(1, Math.floor(naturalH * scale));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // 先铺一层白色背景，避免透明区域导出成黑色
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob) downloadBlob(`${filename}-${Date.now()}.jpg`, blob);
        },
        'image/jpeg',
        0.95
      );
    }
  };
  img.onerror = () => {};
  img.src = dataUrl;
}
