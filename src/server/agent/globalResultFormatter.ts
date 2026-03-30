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

  return result.message;
}
