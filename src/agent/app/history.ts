import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ChatCompletionMessageParam as CompatMessageParam } from "@aistudio/ai/compat/global/core/ai/type";
import { sdkContentToText } from "@shared/chat/sdkMessages";

export const normalizeMessageContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return sdkContentToText(content);
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      parts.push(block.text.trim());
    } else if (block.type === "attachment") {
      const name = typeof block.name === "string" ? block.name.trim() : "";
      const storagePath = typeof block.storage_path === "string" ? block.storage_path.trim() : "";
      const mime = typeof block.mime_type === "string" ? block.mime_type.trim() : "";
      if (name || storagePath) {
        parts.push(`[attachment] name=${name || "file"} path=${storagePath || "unknown"}${mime ? ` mime=${mime}` : ""}`);
      }
    }
  }
  return parts.join("\n") || sdkContentToText(content);
};

export const extractSystemDirectives = (messages: CompatMessageParam[]): string[] =>
  messages
    .filter((m) => m.role === "system")
    .map((m) => normalizeMessageContent((m as { content?: unknown }).content).trim())
    .filter(Boolean);

export const extractCurrentAttachments = (messages: CompatMessageParam[]): string[] => {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const content = (lastUser as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .filter((item) => item.type === "attachment")
    .map((item) => {
      const name = typeof item.name === "string" ? item.name.trim() : "file";
      const filePath = typeof item.storage_path === "string" ? item.storage_path.trim() : "";
      return filePath ? `${name}: ${filePath}` : name;
    });
};

/** 从历史消息的 additional_kwargs 中提取用户在上一轮提交的交互审批/回答，附带给模型继续执行 */
export const extractInteractionNotes = (historyMessages: unknown): string[] => {
  if (!Array.isArray(historyMessages)) return [];
  const notes: string[] = [];
  for (const raw of historyMessages) {
    if (!raw || typeof raw !== "object") continue;
    const kwargs = (raw as { additional_kwargs?: Record<string, unknown> }).additional_kwargs;
    if (!kwargs || typeof kwargs !== "object") continue;

    const q = kwargs.planQuestionResponse as { answers?: Record<string, string> } | undefined;
    if (q?.answers && typeof q.answers === "object") {
      const text = Object.entries(q.answers)
        .filter(([, v]) => typeof v === "string" && v.trim())
        .map(([k, v]) => `"${k}"="${String(v).trim()}"`)
        .join(", ");
      if (text) notes.push(`[User answered clarifying questions]: ${text}`);
    }

    const plan = kwargs.planModeApprovalResponse as { decision?: string; action?: string } | undefined;
    if (plan) {
      notes.push(
        plan.decision === "reject"
          ? "[User rejected the plan. Refine it before coding.]"
          : "[User approved the plan. You can now start implementing.]",
      );
    }

    const perm = kwargs.permissionApprovalResponse as { decision?: string; toolName?: string } | undefined;
    if (perm) {
      notes.push(
        perm.decision === "reject"
          ? `[User rejected permission${perm.toolName ? ` for ${perm.toolName}` : ""}.]`
          : `[User approved permission${perm.toolName ? ` for ${perm.toolName}` : ""}.]`,
      );
    }
  }
  return notes;
};

export const toOpenAIHistory = (
  messages: CompatMessageParam[],
  historyMessages?: unknown,
): ChatCompletionMessageParam[] => {
  const result: ChatCompletionMessageParam[] = [];
  for (const entry of messages) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.role !== "user" && entry.role !== "assistant") continue;
    const content = normalizeMessageContent((entry as { content?: unknown }).content).trim();
    if (entry.role === "user" && Array.isArray(entry.content)) {
      const blocks: import("openai/resources/chat/completions").ChatCompletionContentPart[] = [];
      for (const item of entry.content as unknown[]) {
        const block = item as {type?:string; source?:{type?:string; media_type?:string; data?:string}} | null;
        const source = block?.source;
        if (block?.type === "image" && source?.type === "base64" && source.data &&
            /^image\/(png|jpeg|gif|webp)$/.test(source.media_type ?? "")) {
          blocks.push({type:"image_url",image_url:{url:`data:${source.media_type};base64,${source.data}`}});
        }
      }
      if (blocks.length) {
        if (content) blocks.unshift({type:"text",text:content});
        result.push({role:"user",content:blocks});
        continue;
      }
    }
    if (!content) continue;
    result.push({ role: entry.role, content });
  }

  const notes = extractInteractionNotes(historyMessages);
  if (notes.length > 0 && result.length > 0) {
    const last = result[result.length - 1];
    if (last.role === "user" && typeof last.content === "string") {
      last.content = `${last.content}\n\n${notes.join("\n")}`;
    } else {
      result.push({ role: "user", content: notes.join("\n") });
    }
  }
  return result;
};
