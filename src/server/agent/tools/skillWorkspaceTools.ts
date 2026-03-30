import { z } from "zod";
import type { AgentToolDefinition } from "./types";
import {
  runWorkspaceAction,
  type WorkspaceActionInput,
} from "@server/skills/workspaceStorage";
import { searchInFilesSchema, type SearchInFilesInput } from "@server/agent/searchInFiles";

const listFilesSchema = z.object({});
const readFileSchema = z.object({ path: z.string() });
const writeFileSchema = z.object({ path: z.string(), content: z.string() });
const replaceInFileSchema = z.object({ path: z.string(), query: z.string(), replace: z.string() });

const toJsonSchema = (schema: z.ZodTypeAny): Record<string, unknown> => {
  if (schema === listFilesSchema) return { type: "object", properties: {} };
  if (schema === readFileSchema) {
    return {
      type: "object",
      properties: { path: { type: "string", description: "以 / 开头的文件路径" } },
      required: ["path"],
    };
  }
  if (schema === writeFileSchema) {
    return {
      type: "object",
      properties: {
        path: { type: "string", description: "以 / 开头的文件路径" },
        content: { type: "string", description: "写入的完整内容" },
      },
      required: ["path", "content"],
    };
  }
  if (schema === replaceInFileSchema) {
    return {
      type: "object",
      properties: {
        path: { type: "string", description: "以 / 开头的文件路径" },
        query: { type: "string", description: "需要替换的文本" },
        replace: { type: "string", description: "替换后的文本" },
      },
      required: ["path", "query", "replace"],
    };
  }
  return {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词或正则" },
      regex: { type: "boolean", description: "是否按正则处理，默认 true" },
      caseSensitive: { type: "boolean", description: "是否区分大小写，默认 true" },
      wholeWord: { type: "boolean", description: "是否整词匹配" },
      includeGlobs: { type: "array", items: { type: "string" }, description: "只搜索匹配这些 glob 的路径" },
      excludeGlobs: { type: "array", items: { type: "string" }, description: "排除匹配这些 glob 的路径" },
      contextLines: { type: "integer", minimum: 0, maximum: 5, description: "返回前后上下文行数" },
      maxResults: { type: "integer", minimum: 1, maximum: 500, description: "全局最大返回命中数" },
    },
    required: ["query"],
  };
};

const safeParse = <T>(schema: z.ZodTypeAny, input: unknown): { ok: true; data: T } | { ok: false; error: string } => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((err) => err.message).join("; ") };
  }
  return { ok: true, data: parsed.data as T };
};

export const createSkillWorkspaceTools = ({
  workspaceId,
  userId,
  projectToken,
  skillId,
}: {
  workspaceId: string;
  userId: string;
  projectToken?: string;
  skillId?: string;
}): AgentToolDefinition[] => {
  const run = (input: WorkspaceActionInput) =>
    runWorkspaceAction(
      {
        workspaceId,
        userId,
        projectToken,
        skillId,
      },
      input
    );

  return [
    {
      name: "list_files",
      description: "列出 workspace 中所有文件路径。",
      parameters: toJsonSchema(listFilesSchema),
      run: async (input) => {
        const parsed = safeParse(listFilesSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return run({ action: "list" });
      },
    },
    {
      name: "read_file",
      description: "读取 workspace 文件内容。",
      parameters: toJsonSchema(readFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ path: string }>(readFileSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return run({ action: "read", path: parsed.data.path });
      },
    },
    {
      name: "write_file",
      description: "写入或覆盖 workspace 文件。",
      parameters: toJsonSchema(writeFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ path: string; content: string }>(writeFileSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return run({
          action: "write",
          path: parsed.data.path,
          content: parsed.data.content,
        });
      },
    },
    {
      name: "replace_in_file",
      description: "替换 workspace 文件中的指定文本。",
      parameters: toJsonSchema(replaceInFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ path: string; query: string; replace: string }>(replaceInFileSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return run({
          action: "replace",
          path: parsed.data.path,
          query: parsed.data.query,
          replace: parsed.data.replace,
        });
      },
    },
    {
      name: "search_in_files",
      description: "在 workspace 内按 rg 风格搜索（正则、glob、上下文）。",
      parameters: toJsonSchema(searchInFilesSchema),
      run: async (input) => {
        const parsed = safeParse<SearchInFilesInput>(searchInFilesSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return run({
          action: "search",
          query: parsed.data.query,
          regex: parsed.data.regex,
          caseSensitive: parsed.data.caseSensitive,
          wholeWord: parsed.data.wholeWord,
          includeGlobs: parsed.data.includeGlobs,
          excludeGlobs: parsed.data.excludeGlobs,
          contextLines: parsed.data.contextLines,
          maxResults: parsed.data.maxResults,
        });
      },
    },
  ];
};
