import { z } from "zod";
import { getProject, hasProjectFilesDir, updateFile } from "../projects/projectStorage";

export type ChangeTracker = {
  changed: boolean;
  paths: Set<string>;
};

export type GlobalToolInput = {
  action: "list" | "read" | "write" | "replace" | "search";
  path?: string;
  content?: string;
  query?: string;
  replace?: string;
  limit?: number;
};

export type GlobalToolResult = {
  ok: boolean;
  action: GlobalToolInput["action"];
  message: string;
  data?: Record<string, unknown>;
  files?: Record<string, { code: string }>;
};

export const globalToolSchema = z.object({
  action: z.enum(["list", "read", "write", "replace", "search"]),
  path: z.string().optional(),
  content: z.string().optional(),
  query: z.string().optional(),
  replace: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const unsafePathPattern = /\\|\.\.|\0/;

function normalizeFilePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("文件路径不能为空");
  }
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (unsafePathPattern.test(withSlash)) {
    throw new Error("文件路径不安全");
  }
  return withSlash;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function replaceAll(haystack: string, needle: string, replacement: string) {
  if (!needle) {
    throw new Error("替换内容不能为空");
  }
  const count = countOccurrences(haystack, needle);
  const content = haystack.split(needle).join(replacement);
  return { content, count };
}

function collectMatches(content: string, query: string, limit: number) {
  const matches: Array<{ line: number; column: number; snippet: string }> = [];
  if (!query) {
    return matches;
  }
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let index = line.indexOf(query);
    while (index !== -1) {
      matches.push({
        line: i + 1,
        column: index + 1,
        snippet: line.trim().slice(0, 160),
      });
      if (matches.length >= limit) {
        return matches;
      }
      index = line.indexOf(query, index + query.length);
    }
  }
  return matches;
}

async function getProjectFiles(token: string) {
  const project = await getProject(token);
  if (!project) {
    throw new Error("项目不存在");
  }

  const hasFilesDir = await hasProjectFilesDir(token);
  if (!hasFilesDir) {
    throw new Error("项目文件目录缺失，请先保存一次项目文件后再试");
  }

  return project.files;
}

export async function runGlobalAction(
  token: string,
  input: GlobalToolInput,
  changeTracker?: ChangeTracker
): Promise<GlobalToolResult> {
  const action = input.action;

  if (action === "list") {
    const files = await getProjectFiles(token);
    const paths = Object.keys(files).sort();
    return {
      ok: true,
      action,
      message: `共 ${paths.length} 个文件。`,
      data: { files: paths },
    };
  }

  if (action === "read") {
    if (!input.path) {
      return { ok: false, action, message: "请提供 path" };
    }
    const path = normalizeFilePath(input.path);
    const files = await getProjectFiles(token);
    const file = files[path];
    if (!file) {
      return { ok: false, action, message: `未找到文件 ${path}` };
    }
    return {
      ok: true,
      action,
      message: `已读取 ${path}。`,
      data: { path, content: file.code },
    };
  }

  if (action === "write") {
    if (!input.path || typeof input.content !== "string") {
      return { ok: false, action, message: "请提供 path 和 content" };
    }
    const path = normalizeFilePath(input.path);
    await updateFile(token, path, input.content);
    changeTracker?.paths.add(path);
    if (changeTracker) changeTracker.changed = true;
    return {
      ok: true,
      action,
      message: `已写入 ${path}。`,
      data: { path, files: { [path]: { code: input.content } } },
      files: { [path]: { code: input.content } },
    };
  }

  if (action === "replace") {
    if (!input.path || typeof input.query !== "string" || typeof input.replace !== "string") {
      return { ok: false, action, message: "请提供 path、query 和 replace" };
    }
    const path = normalizeFilePath(input.path);
    const files = await getProjectFiles(token);
    const file = files[path];
    if (!file) {
      return { ok: false, action, message: `未找到文件 ${path}` };
    }
    const { content, count } = replaceAll(file.code, input.query, input.replace);
    await updateFile(token, path, content);
    changeTracker?.paths.add(path);
    if (changeTracker) changeTracker.changed = true;
    return {
      ok: true,
      action,
      message: `已在 ${path} 中替换 ${count} 处。`,
      data: { path, replaced: count, files: { [path]: { code: content } } },
      files: { [path]: { code: content } },
    };
  }

  if (action === "search") {
    if (!input.query) {
      return { ok: false, action, message: "请提供 query" };
    }
    const files = await getProjectFiles(token);
    const limit = input.limit ?? 50;
    const results: Array<{ path: string; matches: Array<{ line: number; column: number; snippet: string }>; total: number }> = [];
    Object.entries(files).forEach(([path, file]) => {
      const matches = collectMatches(file.code, input.query!, limit);
      if (matches.length === 0) return;
      results.push({ path, matches, total: matches.length });
    });

    return {
      ok: true,
      action,
      message: `搜索 "${input.query}" 完成。`,
      data: { results },
    };
  }

  return { ok: false, action, message: "不支持的操作" };
}

export type GlobalCommandParseResult =
  | { ok: true; input: GlobalToolInput }
  | { ok: false; message: string; hint?: string };

export function parseGlobalCommand(text: string): GlobalCommandParseResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/global")) {
    return null;
  }

  const rest = trimmed.replace(/^\/global\s*/, "").trim();
  if (!rest) {
    return {
      ok: false,
      message: "请提供 global 指令参数。",
      hint: "示例: /global list 或 /global {\"action\":\"read\",\"path\":\"/App.js\"}",
    };
  }

  if (rest.startsWith("{")) {
    try {
      const payload = JSON.parse(rest) as GlobalToolInput;
      const parsed = globalToolSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, message: "global 参数格式错误" };
      }
      return { ok: true, input: parsed.data };
    } catch (error) {
      return { ok: false, message: "global JSON 解析失败" };
    }
  }

  const [action, ...args] = rest.split(/\s+/);
  if (!action) {
    return { ok: false, message: "未识别 global 操作" };
  }

  if (action === "list") {
    return { ok: true, input: { action: "list" } };
  }

  if (action === "read") {
    if (!args[0]) {
      return { ok: false, message: "请提供读取路径，例如 /global read /App.js" };
    }
    return { ok: true, input: { action: "read", path: args[0] } };
  }

  if (action === "search") {
    if (args.length === 0) {
      return { ok: false, message: "请提供搜索关键字，例如 /global search useState" };
    }
    return { ok: true, input: { action: "search", query: args.join(" ") } };
  }

  return {
    ok: false,
    message: "该操作建议使用 JSON 参数。",
    hint: "示例: /global {\"action\":\"replace\",\"path\":\"/App.js\",\"query\":\"foo\",\"replace\":\"bar\"}",
  };
}
