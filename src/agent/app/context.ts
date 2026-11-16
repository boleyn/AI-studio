import { getChatModelProfile } from "@server/aiProxy/catalogStore";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000;

export function getContextWindowForModel(model: string): number {
  const trimmed = (model || "").trim();
  if (/\[1m\]/i.test(trimmed)) return 1_000_000;

  const profile = getChatModelProfile(trimmed);
  if (
    profile &&
    typeof profile.maxContext === "number" &&
    Number.isFinite(profile.maxContext) &&
    profile.maxContext > 0
  ) {
    return Math.floor(profile.maxContext);
  }

  const lower = trimmed.toLowerCase();
  if (lower.includes("gemini")) return 1_000_000;
  if (lower.includes("gpt-4o") || lower.includes("gpt-4.1") || lower.includes("o3") || lower.includes("o4")) {
    return 128_000;
  }
  return MODEL_CONTEXT_WINDOW_DEFAULT;
}

export type TokenBudgetPayload = {
  used: number;
  total: number;
  percentage: number;
  model: string;
  usedTokens: number;
  maxContext: number;
  remainingTokens: number;
  usedPercent: number;
};

export function toTokenBudget(params: {
  promptTokens: number;
  completionTokens: number;
  model: string;
}): TokenBudgetPayload {
  const usedTokens = Math.max(0, Math.floor(params.promptTokens + params.completionTokens));
  const maxContext = Math.max(1, getContextWindowForModel(params.model));
  const usedPercent = Math.max(0, Math.min(100, (usedTokens / maxContext) * 100));
  return {
    used: usedTokens,
    total: maxContext,
    percentage: usedPercent,
    model: params.model,
    usedTokens,
    maxContext,
    remainingTokens: Math.max(0, maxContext - usedTokens),
    usedPercent,
  };
}

/** 粗略估算字符对应的 token 数（用于超长历史保护） */
const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

export function trimHistoryToBudget(
  messages: ChatCompletionMessageParam[],
  maxContext: number,
): { messages: ChatCompletionMessageParam[]; compacted: boolean } {
  const budget = Math.floor(maxContext * 0.78);
  let total = 0;
  const serialized = messages.map((m) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
    const tokens = estimateTokens(content) + 12;
    total += tokens;
    return tokens;
  });
  if (total <= budget || messages.length <= 4) return { messages, compacted: false };

  // 保留首条/系统消息与最近若干条消息，中间裁剪
  const keptTail: ChatCompletionMessageParam[] = [];
  let running = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (running + serialized[i] > budget && keptTail.length >= 2) break;
    keptTail.unshift(messages[i]);
    running += serialized[i];
  }
  return {
    messages: [
      {
        role: "system",
        content: `[Context compacted: ${messages.length - keptTail.length} earlier message(s) omitted to fit context window.]`,
      },
      ...keptTail,
    ],
    compacted: true,
  };
}
