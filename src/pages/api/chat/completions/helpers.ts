import type { ChatCompletionMessageParam } from "@aistudio/ai/compat/global/core/ai/type";
import type { AgentToolDefinition } from "@server/agent/tools/types";
import { createDataId } from "@shared/chat/ids";
import { extractText, type IncomingMessage } from "@shared/chat/messages";
import type { NextApiRequest, NextApiResponse } from "next";
import type { ConversationMessage } from "@server/conversations/conversationStorage";
import path from "node:path";

export const getToken = (req: NextApiRequest): string | null => {
  const headerToken =
    typeof req.headers["x-project-token"] === "string"
      ? req.headers["x-project-token"]
      : null;
  const queryToken = typeof req.query.token === "string" ? req.query.token : null;
  const bodyToken = typeof req.body?.token === "string" ? req.body.token : null;
  return headerToken ?? bodyToken ?? queryToken;
};

export const sendSseEvent = (res: NextApiResponse, event: string, data: string) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
  const streamRes = res as NextApiResponse & { flush?: () => void };
  streamRes.flush?.();
};

export const startSse = (res: NextApiResponse) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  const streamRes = res as NextApiResponse & { flushHeaders?: () => void };
  streamRes.flushHeaders?.();
};

export const startSseHeartbeat = (res: NextApiResponse, intervalMs = 15000) => {
  const timer = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
      const streamRes = res as NextApiResponse & { flush?: () => void };
      streamRes.flush?.();
    } catch {
      clearInterval(timer);
    }
  }, intervalMs);

  return () => clearInterval(timer);
};

export const toIncomingMessages = (messages: unknown): IncomingMessage[] => {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => {
      if (!message || typeof message !== "object") return null;
      const record = message as {
        role?: string;
        content?: unknown;
        id?: string;
        name?: string;
        tool_call_id?: string;
        tool_calls?: IncomingMessage["tool_calls"];
        additional_kwargs?: IncomingMessage["additional_kwargs"];
        status?: IncomingMessage["status"];
        artifact?: IncomingMessage["artifact"];
      };
      if (!record.role) return null;
      const role = record.role;
      if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") {
        return null;
      }
      return {
        role,
        content: record.content ?? "",
        id: record.id,
        name: record.name,
        tool_call_id: record.tool_call_id,
        tool_calls: record.tool_calls,
        additional_kwargs: record.additional_kwargs,
        status: record.status,
        artifact: record.artifact,
      } as IncomingMessage;
    })
    .filter((message): message is IncomingMessage => Boolean(message));
};

const CONVERSATION_ROLES = ["user", "assistant", "system", "tool"] as const;
type ConversationRole = (typeof CONVERSATION_ROLES)[number];

export const chatCompletionMessageToConversationMessage = (
  message: ChatCompletionMessageParam
): ConversationMessage => {
  const role = CONVERSATION_ROLES.includes(message.role as ConversationRole)
    ? (message.role as ConversationRole)
    : "assistant";
  const content =
    typeof (message as { content?: unknown }).content === "string"
      ? (message as { content: string }).content
      : extractText((message as { content?: unknown }).content);
  return {
    role,
    content: content ?? "",
    id: (message as { id?: string }).id ?? createDataId(),
    name: (message as { name?: string }).name,
    tool_call_id: (message as { tool_call_id?: string }).tool_call_id,
    tool_calls: (message as { tool_calls?: ConversationMessage["tool_calls"] }).tool_calls,
  };
};

export const normalizeStoredMessages = (messages: ConversationMessage[]) => {
  const seen = new Set<string>();
  const result: ConversationMessage[] = [];
  for (const message of [...messages].reverse()) {
    const id = message.id ?? createDataId();
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({ ...message, id });
  }
  return result.reverse();
};

export const toStringValue = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export type UserArtifactFileMeta = {
  name: string;
  type: string;
  storagePath: string;
  workspacePath: string;
  isImage: boolean;
};

export const getUserArtifactFiles = (message: ConversationMessage): UserArtifactFileMeta[] => {
  if (message.role !== "user" || !message.artifact || typeof message.artifact !== "object") return [];
  const files = Array.isArray((message.artifact as { files?: unknown }).files)
    ? ((message.artifact as { files?: unknown }).files as unknown[])
    : [];
  return files
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const name = typeof item.name === "string" ? item.name : "file";
      const type = typeof item.type === "string" ? item.type : "";
      const storagePath = typeof item.storagePath === "string" ? item.storagePath : "";
      const workspacePath = `/.files/${path.posix.basename(storagePath || name)}`;
      return {
        name,
        type,
        storagePath,
        workspacePath,
        isImage: type.toLowerCase().startsWith("image/"),
      };
    });
};

export const getLatestUserArtifactFiles = (messages: ConversationMessage[]): UserArtifactFileMeta[] => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const files = getUserArtifactFiles(message);
    if (files.length > 0) return files;
  }
  return [];
};

export const buildAttachmentHintText = (files: UserArtifactFileMeta[]) => {
  if (files.length === 0) return "";
  const imageFiles = files.filter((item) => item.isImage);
  const imageCount = imageFiles.length;
  const docFiles = files.filter((item) => !item.isImage);
  const lines: string[] = ["【附件信息】"];
  if (imageCount > 0) {
    lines.push(
      `- 本轮包含图片 ${imageCount} 张。请用 Read(mode=vision, storagePath=...) 进行图片识别；也可用 mode=auto。需要特定识别目标时可传 prompt。`
    );
    const imagePreviews = imageFiles.slice(0, 8).map((file) => {
      const typePart = file.type ? ` | type=${file.type}` : "";
      const wsPathPart = file.workspacePath ? ` | path=${file.workspacePath}` : "";
      const pathPart = file.storagePath ? ` | storagePath=${file.storagePath}` : "";
      return `  - ${file.name}${typePart}${wsPathPart}${pathPart}`;
    });
    lines.push(...imagePreviews);
  }
  if (docFiles.length > 0) {
    lines.push(
      `- 本轮包含文档 ${docFiles.length} 个。优先用 Read(file_path=/.files/<文件名>)；若用 Bash/python，请用相对路径 .files/<文件名>（不要 /files 或 /.files）。`
    );
    const previews = docFiles.slice(0, 8).map((file) => {
      const typePart = file.type ? ` | type=${file.type}` : "";
      const wsPathPart = file.workspacePath ? ` | path=${file.workspacePath}` : "";
      const pathPart = file.storagePath ? ` | storagePath=${file.storagePath}` : "";
      return `  - ${file.name}${typePart}${wsPathPart}${pathPart}`;
    });
    lines.push(...previews);
    if (docFiles.length > 8) {
      lines.push(`  - ... 其余 ${docFiles.length - 8} 个文档可通过 fileName 模糊匹配读取`);
    }
  }
  return lines.join("\n");
};

export const getTitleFromMessages = (messages: ConversationMessage[]): string | undefined => {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser) return undefined;
  const text = extractText(lastUser.content).trim();
  if (!text) return undefined;
  return text.length > 40 ? `${text.slice(0, 40)}...` : text;
};

export const isModelUnavailableError = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /does not exist|do not have access|model.*not found/i.test(text);
};

const CODE_INTENT_PATTERN =
  /(改|修改|修复|重构|实现|加个|排查|debug|fix|refactor|implement|code|代码|文件|函数|接口|api|bug|报错)/i;
const TOOLING_INTENT_PATTERN =
  /(写工具|工具开发|新增工具|两个工具|2个工具|build tool|create tool|tooling|tool|替换|replace|修改文件|write_file|replace_in_file|\bwrite\b|\bedit\b|\bread\b|\bbash\b)/i;

export const PROJECT_LOCAL_TOOL_NAMES = new Set([
  "Glob",
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Bash",
]);

export const ALWAYS_KEEP_TOOL_NAMES = new Set([
  "Glob",
  "Read",
  "Grep",
  "Write",
  "Edit",
  "Bash",
]);

const MCP_TOOL_NAME_PREFIX = "mcp_";

export const isMcpToolName = (toolName: string) => toolName.startsWith(MCP_TOOL_NAME_PREFIX);

export const isProjectKnowledgeMcpTool = (toolName: string) => {
  if (!isMcpToolName(toolName)) return false;
  const normalized = toolName.toLowerCase();
  return (
    normalized.includes("gitlab") ||
    normalized.includes("kb") ||
    normalized.includes("knowledge") ||
    normalized.includes("analysis") ||
    normalized.includes("project")
  );
};

export type UserIntent = "tooling" | "coding" | "general";

export type ToolRouteResult = {
  selectedTools: AgentToolDefinition[];
  reason: string;
};

export const getLastUserText = (messages: ConversationMessage[]) => {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser) return "";
  return extractText(lastUser.content).trim();
};

export const getSelectedSkillFromMessages = (messages: ConversationMessage[]) => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") continue;
    const selectedSkills = (message.additional_kwargs as { selectedSkills?: unknown }).selectedSkills;
    if (Array.isArray(selectedSkills)) {
      const first = selectedSkills.find((item) => typeof item === "string" && item.trim());
      if (typeof first === "string" && first.trim()) {
        return first.trim();
      }
    }
    const selectedSkill = (message.additional_kwargs as { selectedSkill?: unknown }).selectedSkill;
    if (typeof selectedSkill === "string" && selectedSkill.trim()) {
      return selectedSkill.trim();
    }
  }
  return "";
};

export const detectUserIntent = (messages: ConversationMessage[]): UserIntent => {
  const text = getLastUserText(messages).toLowerCase();
  if (!text) return "general";
  if (TOOLING_INTENT_PATTERN.test(text)) return "tooling";
  if (CODE_INTENT_PATTERN.test(text)) return "coding";
  return "general";
};

export const routeToolsByIntent = (allTools: AgentToolDefinition[], intent: UserIntent): ToolRouteResult => {
  if (intent === "tooling") {
    const toolBuildTools = allTools.filter((tool) =>
      [
        "Glob",
        "Grep",
        "Read",
        "Edit",
        "Write",
        "Bash",
      ].includes(tool.name)
    );

    if (toolBuildTools.length > 0) {
      return { selectedTools: toolBuildTools, reason: "tooling_with_edit_tools" };
    }

    const fallbackNonLocal = allTools.filter((tool) => !PROJECT_LOCAL_TOOL_NAMES.has(tool.name));
    if (fallbackNonLocal.length > 0) {
      return { selectedTools: fallbackNonLocal, reason: "tooling_with_non_local_tools" };
    }
  }

  if (intent === "coding") {
    const codingTools = allTools.filter(
      (tool) => PROJECT_LOCAL_TOOL_NAMES.has(tool.name) || isMcpToolName(tool.name)
    );

    if (codingTools.length > 0) {
      return { selectedTools: codingTools, reason: "coding_with_project_tools" };
    }
  }

  return { selectedTools: allTools, reason: "fallback_all_tools" };
};

export const resolveToolChoice = (intent: UserIntent): "auto" | "required" => {
  if (intent === "tooling") return "required";
  if (intent === "coding") return "required";
  return "auto";
};

export const normalizeToolChoiceMode = (value: unknown): "auto" | "required" | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto") return "auto";
  if (normalized === "required") return "required";
  return undefined;
};

export const buildToolRoutingSystemPrompt = (
  intent: UserIntent,
  route: ToolRouteResult,
  toolChoiceMode: "auto" | "required"
) => {
  const toolNames = route.selectedTools.map((tool) => tool.name).join(", ") || "(none)";
  const intentRule =
    intent === "tooling"
      ? "Current task intent is tooling. Prefer Edit/Write/Read/Grep/Glob and make concrete file edits. Do not do one-shot large file writes; split into smaller incremental edits."
      : intent === "coding"
      ? "Current task intent is coding. Prioritize project code tools and available MCP reference tools. Read/search before write. Do not do one-shot large file writes; split into multiple smaller files or incremental write/replace steps."
      : "Current task intent is general. Use tools only when they materially improve correctness.";
  const mandatoryRule =
    toolChoiceMode === "required"
      ? "- You must call at least one allowed tool before providing the final answer."
      : "- Tool calls are optional; use them when needed for correctness.";

  return [
    "Runtime tool routing policy:",
    `- intent: ${intent}`,
    `- route_reason: ${route.reason}`,
    `- tool_choice_mode: ${toolChoiceMode}`,
    `- allowed_tools: ${toolNames}`,
    `- ${intentRule}`,
    "- Do not call tools outside allowed_tools.",
    mandatoryRule,
    "- Prefer the minimum number of tool calls needed to complete the task.",
  ].join("\n");
};
