import type { ChatCompletionMessageParam } from "@aistudio/ai/compat/global/core/ai/type";
import { createDataId } from "@shared/chat/ids";
import { extractText } from "@shared/chat/messages";
import type { NextApiRequest, NextApiResponse } from "next";
import { toToolMemoryMessages } from "@server/chat/completions/toolMemory";
import type { ConversationMessage } from "@server/conversations/conversationStorage";

type IncomingMessage = {
  role?: string;
  content?: unknown;
};

type SupportedRole = ConversationMessage["role"];

export type TimelineItem = {
  type: "reasoning" | "answer" | "tool";
  text?: string;
  id?: string;
  toolName?: string;
  params?: string;
  response?: string;
};

export const STUDIO_PROMPT = [
  "You are running in Skill Creator Studio.",
  "This studio is isolated from project files.",
  "Only edit files inside this workspace.",
  "Reference resolution rule: if user says 'this skill/这个 skill/当前 skill' without naming one, they mean the current workspace skill files, not the built-in skill named skill-creator.",
  "For that kind of question, inspect workspace files first (e.g. Glob + Read for /<slug>/SKILL.md) and answer from those files.",
  "After reading the relevant SKILL.md once, provide a direct answer. Do not call Read repeatedly for the same path in one reply unless the user explicitly asks for re-check.",
  "Skill workspace uses foldered root paths. Keep the main definition at /<slug>/SKILL.md.",
  "When creating or updating /<slug>/SKILL.md, always include YAML frontmatter at the top.",
  "The frontmatter must start and end with --- and include at least:",
  "name: <kebab-case-skill-name>",
  "description: <one-line-purpose-and-trigger>",
  "Optional fields: version, compatibility, license, metadata.",
  "The frontmatter name must match the intended skill slug.",
].join("\n");

export const toMessages = (messages: unknown): ConversationMessage[] => {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((item) => {
      const msg = item as IncomingMessage;
      const role = msg?.role as SupportedRole | undefined;
      if (!role || !["user", "assistant", "system", "tool"].includes(role)) return null;
      const content =
        typeof msg.content === "string" ? msg.content : extractText(msg.content).trim();
      return {
        role,
        content: content || "",
        id: createDataId(),
      } as ConversationMessage;
    })
    .filter((item): item is ConversationMessage => Boolean(item));
};

export const toAgentMessages = (messages: ConversationMessage[]): ChatCompletionMessageParam[] => {
  const output: ChatCompletionMessageParam[] = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      const toolMemoryMessages = toToolMemoryMessages(message);
      if (toolMemoryMessages.length > 0) {
        output.push(...toolMemoryMessages);
      }

      const assistantText = extractText(message.content).trim();
      if (assistantText) {
        output.push({
          role: "assistant",
          content: assistantText,
        } as ChatCompletionMessageParam);
      }
      continue;
    }

    output.push({
      role: message.role,
      content: extractText(message.content),
    } as ChatCompletionMessageParam);
  }

  return output;
};

export const getConversationId = (req: NextApiRequest) =>
  typeof req.body?.conversation_id === "string"
    ? req.body.conversation_id
    : typeof req.body?.conversationId === "string"
    ? req.body.conversationId
    : undefined;

export const getConversationToken = (req: NextApiRequest, projectToken: string, workspaceId: string) => {
  const bodyToken = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (bodyToken.startsWith("skill-studio:")) {
    return bodyToken;
  }
  const scope = projectToken || "global";
  return `skill-studio:${scope}:${workspaceId}`;
};

export const getRunToken = (req: NextApiRequest, fallback: string) => {
  const bodyToken = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  return bodyToken || fallback;
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

export const getWorkspaceId = (req: NextApiRequest) => {
  const fromBody = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "";
  if (fromBody) return fromBody;
  const fromQuery = req.query.workspaceId;
  if (Array.isArray(fromQuery)) return fromQuery[0] || "";
  return typeof fromQuery === "string" ? fromQuery : "";
};

export const getProjectToken = (req: NextApiRequest) => {
  const fromBody = typeof req.body?.projectToken === "string" ? req.body.projectToken : "";
  if (fromBody) return fromBody;
  const fromQuery = req.query.projectToken;
  if (Array.isArray(fromQuery)) return fromQuery[0] || "";
  return typeof fromQuery === "string" ? fromQuery : "";
};

export const getSkillId = (req: NextApiRequest) => {
  const fromBody = typeof req.body?.skillId === "string" ? req.body.skillId : "";
  if (fromBody) return fromBody;
  const fromQuery = req.query.skillId;
  if (Array.isArray(fromQuery)) return fromQuery[0] || "";
  return typeof fromQuery === "string" ? fromQuery : "";
};

export const toSelectedSkills = (req: NextApiRequest) => {
  const fromArray = Array.isArray(req.body?.selectedSkills)
    ? (req.body.selectedSkills as unknown[])
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const fromSingle = typeof req.body?.selectedSkill === "string" ? req.body.selectedSkill.trim() : "";
  const merged = [...fromArray, ...(fromSingle ? [fromSingle] : [])];
  return Array.from(new Set(merged));
};

export const normalizeToolChoiceMode = (value: unknown): "auto" | "required" | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto") return "auto";
  if (normalized === "required") return "required";
  return undefined;
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
