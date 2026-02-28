import { z } from "zod";
import type { ChangeTracker, GlobalToolInput } from "../globalTools";
import { globalToolSchema, runGlobalAction } from "../globalTools";
import type { AgentToolDefinition } from "./types";
import { getProject } from "@server/projects/projectStorage";

const listFilesSchema = z.object({});
const readFileSchema = z.object({ path: z.string() });
const writeFileSchema = z.object({ path: z.string(), content: z.string() });
const replaceInFileSchema = z.object({ path: z.string(), query: z.string(), replace: z.string() });
const searchInFilesSchema = z.object({ query: z.string(), limit: z.number().int().min(1).max(200).optional() });
const sandpackCompileInfoSchema = z.object({
  includeLogs: z.boolean().optional(),
  includeEvents: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

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
  if (schema === searchInFilesSchema) {
    return {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "最多返回条数" },
      },
      required: ["query"],
    };
  }
  if (schema === sandpackCompileInfoSchema) {
    return {
      type: "object",
      properties: {
        includeLogs: { type: "boolean", description: "是否返回 console 日志，默认 true" },
        includeEvents: { type: "boolean", description: "是否返回编译事件，默认 true" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "日志与事件最大返回条数，默认 30" },
      },
    };
  }
  return { type: "object" };
};

const safeParse = <T>(schema: z.ZodTypeAny, input: unknown): { ok: true; data: T } | { ok: false; error: string } => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((err) => err.message).join("; ") };
  }
  return { ok: true, data: parsed.data as T };
};

export function createProjectTools(token: string, changeTracker: ChangeTracker): AgentToolDefinition[] {
  return [
    {
      name: "list_files",
      description: "列出项目中的所有文件路径。",
      parameters: toJsonSchema(listFilesSchema),
      run: async (input) => {
        const parsed = safeParse(listFilesSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return runGlobalAction(token, { action: "list" }, changeTracker);
      },
    },
    {
      name: "read_file",
      description: "读取项目中的文件内容。",
      parameters: toJsonSchema(readFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ path: string }>(readFileSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return runGlobalAction(token, { action: "read", path: parsed.data.path }, changeTracker);
      },
    },
    {
      name: "write_file",
      description: "在项目中创建或覆盖文件内容。",
      parameters: toJsonSchema(writeFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ path: string; content: string }>(writeFileSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return runGlobalAction(
          token,
          { action: "write", path: parsed.data.path, content: parsed.data.content },
          changeTracker
        );
      },
    },
    {
      name: "replace_in_file",
      description: "替换文件中的指定文本。",
      parameters: toJsonSchema(replaceInFileSchema),
      run: async (input) => {
        const parsed = safeParse<{ path: string; query: string; replace: string }>(replaceInFileSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return runGlobalAction(
          token,
          { action: "replace", path: parsed.data.path, query: parsed.data.query, replace: parsed.data.replace },
          changeTracker
        );
      },
    },
    {
      name: "search_in_files",
      description: "在项目中搜索指定关键词。",
      parameters: toJsonSchema(searchInFilesSchema),
      run: async (input) => {
        const parsed = safeParse<{ query: string; limit?: number }>(searchInFilesSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);
        return runGlobalAction(
          token,
          { action: "search", query: parsed.data.query, limit: parsed.data.limit },
          changeTracker
        );
      },
    },
    {
      name: "compile_project",
      description: "编译当前项目代码并返回错误。",
      parameters: toJsonSchema(sandpackCompileInfoSchema),
      run: async (input) => {
        const parsed = safeParse<{
          includeLogs?: boolean;
          includeEvents?: boolean;
          limit?: number;
        }>(sandpackCompileInfoSchema, input);
        if (!parsed.ok) throw new Error(parsed.error);

        const project = await getProject(token);
        if (!project) {
          throw new Error("项目不存在");
        }
        const compileInfo = project.sandpackCompileInfo;
        if (!compileInfo) {
          return {
            ok: false,
            message: "暂无 Sandpack 编译信息。请先在编辑器/预览中触发一次运行后再试。",
          };
        }

        const limit = parsed.data.limit ?? 30;
        const includeLogs = parsed.data.includeLogs !== false;
        const includeEvents = parsed.data.includeEvents !== false;

        return {
          ok: true,
          status: compileInfo.status,
          updatedAt: compileInfo.updatedAt,
          lastEventType: compileInfo.lastEventType || "",
          lastEventText: compileInfo.lastEventText || "",
          errors: compileInfo.errors.slice(-limit),
          events: includeEvents ? compileInfo.events.slice(-limit) : [],
          logs: includeLogs ? compileInfo.logs.slice(-limit) : [],
        };
      },
    },
    {
      name: "global",
      description: "通用文件操作工具，支持 list/read/write/replace/search。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "read", "write", "replace", "search"] },
          path: { type: "string" },
          content: { type: "string" },
          query: { type: "string" },
          replace: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        required: ["action"],
      },
      run: async (input) => {
        const parsed = globalToolSchema.safeParse(input);
        if (!parsed.success) {
          throw new Error(parsed.error.issues.map((err) => err.message).join("; "));
        }
        return runGlobalAction(token, parsed.data as GlobalToolInput, changeTracker);
      },
    },
  ];
}
