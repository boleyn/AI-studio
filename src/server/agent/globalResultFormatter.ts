import type { GlobalToolResult } from "./globalTools";

export function formatGlobalResult(result: GlobalToolResult): string {
  if (!result.ok) {
    return `global 失败: ${result.message}`;
  }

  if (result.action === "read") {
    const data = result.data as { path?: string; content?: string } | undefined;
    if (data?.content) {
      return `已读取 ${data.path}\n\n${data.content}`;
    }
  }

  if (result.action === "list") {
    const data = result.data as { files?: string[] } | undefined;
    if (data?.files) {
      return `文件列表 (共 ${data.files.length} 个):\n${data.files.join("\n")}`;
    }
  }

  if (result.action === "search") {
    const data = result.data as { results?: Array<{ path: string; matches: any[] }> } | undefined;
    if (data?.results) {
      const summary = data.results
        .map((entry) => `${entry.path} (${entry.matches.length})`)
        .join("\n");
      return `搜索结果:\n${summary}`;
    }
  }

  return result.message;
}
