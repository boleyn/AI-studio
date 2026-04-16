// @ts-nocheck
// @ts-nocheck
import { countGptMessagesTokens } from "@aistudio/ai/compat/common/string/tiktoken/index";
import { compressRequestMessages } from "@aistudio/ai/llm/compress";
import type { LLMModelItemType } from "@aistudio/ai/compat/global/core/ai/model.d";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "@aistudio/ai/compat/global/core/ai/type";

export type ContextManagementStep = {
  name: "budget" | "micro_compact" | "history_compress" | "fallback_round_prune";
  triggered: boolean;
  beforeTokens: number;
  afterTokens: number;
  tokensFreed: number;
};

export type ContextManagementMeta = {
  steps: ContextManagementStep[];
  tokensFreed: number;
  fallbackApplied: boolean;
  finalPromptTokens: number;
};

const CONTEXT_TRIGGER_RATIO = 0.82;
const HARD_LIMIT_RATIO = 0.95;
const TOOL_CONTENT_CHAR_THRESHOLD = 2000;

const toContentText = (content: unknown) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const record = part as Record<string, unknown>;
        if (typeof record.text === "string") return record.text;
        if (typeof record.content === "string") return record.content;
        return "";
      })
      .join("\n");
  }
  return "";
};

const microCompactMessages = (messages: ChatCompletionMessageParam[]) => {
  let changed = false;
  const compacted = messages.map((message) => {
    if (message.role !== "tool") return message;
    const text = toContentText((message as { content?: unknown }).content);
    if (text.length <= TOOL_CONTENT_CHAR_THRESHOLD) return message;
    changed = true;
    return {
      ...message,
      content: `[tool_result_compacted chars=${text.length}]`,
    } as ChatCompletionMessageParam;
  });
  return { changed, messages: compacted };
};

const pruneByUserRounds = async ({
  messages,
  tools,
  maxContext,
}: {
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
  maxContext: number;
}) => {
  const systemMessages = messages.filter((item) => item.role === "system");
  const chatMessages = messages.filter((item) => item.role !== "system");

  let roundsToKeep = 12;
  let best = messages;
  while (roundsToKeep >= 1) {
    const selected: ChatCompletionMessageParam[] = [];
    let remainingUsers = roundsToKeep;
    for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
      selected.unshift(chatMessages[i]);
      if (chatMessages[i].role === "user") {
        remainingUsers -= 1;
        if (remainingUsers <= 0) break;
      }
    }
    const candidate = [...systemMessages, ...selected];
    const tokens = await countGptMessagesTokens(candidate, tools).catch(() => Number.MAX_SAFE_INTEGER);
    best = candidate;
    if (tokens <= Math.floor(maxContext * HARD_LIMIT_RATIO)) {
      return { messages: candidate, fallbackApplied: true };
    }
    roundsToKeep -= 1;
  }

  return { messages: best, fallbackApplied: true };
};

export const manageContextWindow = async ({
  messages,
  tools,
  model,
  focusQuery,
  enabled = true,
}: {
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
  model: LLMModelItemType;
  focusQuery?: string;
  enabled?: boolean;
}): Promise<{ messages: ChatCompletionMessageParam[]; meta: ContextManagementMeta }> => {
  const maxContext = Math.max(1, model.maxContext || 16000);
  const steps: ContextManagementStep[] = [];

  const beforeBudget = await countGptMessagesTokens(messages, tools).catch(() => 0);
  steps.push({
    name: "budget",
    triggered: true,
    beforeTokens: beforeBudget,
    afterTokens: beforeBudget,
    tokensFreed: 0,
  });

  if (!enabled) {
    return {
      messages,
      meta: {
        steps,
        tokensFreed: 0,
        fallbackApplied: false,
        finalPromptTokens: beforeBudget,
      },
    };
  }

  let working = [...messages];
  let fallbackApplied = false;

  const beforeMicro = await countGptMessagesTokens(working, tools).catch(() => 0);
  const micro = microCompactMessages(working);
  if (micro.changed) {
    working = micro.messages;
  }
  const afterMicro = await countGptMessagesTokens(working, tools).catch(() => beforeMicro);
  steps.push({
    name: "micro_compact",
    triggered: micro.changed,
    beforeTokens: beforeMicro,
    afterTokens: afterMicro,
    tokensFreed: Math.max(0, beforeMicro - afterMicro),
  });

  const ratioAfterMicro = afterMicro / maxContext;
  const beforeCompress = afterMicro;
  let afterCompress = beforeCompress;
  if (ratioAfterMicro >= CONTEXT_TRIGGER_RATIO) {
    const compressed = await compressRequestMessages({
      messages: working,
      model,
      focusQuery,
      force: true,
    });
    if (compressed.messages.length > 0) {
      working = compressed.messages;
    }
    afterCompress = await countGptMessagesTokens(working, tools).catch(() => beforeCompress);
  }

  steps.push({
    name: "history_compress",
    triggered: ratioAfterMicro >= CONTEXT_TRIGGER_RATIO,
    beforeTokens: beforeCompress,
    afterTokens: afterCompress,
    tokensFreed: Math.max(0, beforeCompress - afterCompress),
  });

  const beforeFallback = afterCompress;
  const ratioAfterCompress = beforeFallback / maxContext;
  let afterFallback = beforeFallback;
  if (ratioAfterCompress >= HARD_LIMIT_RATIO) {
    const pruned = await pruneByUserRounds({
      messages: working,
      tools,
      maxContext,
    });
    working = pruned.messages;
    fallbackApplied = pruned.fallbackApplied;
    afterFallback = await countGptMessagesTokens(working, tools).catch(() => beforeFallback);
  }

  steps.push({
    name: "fallback_round_prune",
    triggered: ratioAfterCompress >= HARD_LIMIT_RATIO,
    beforeTokens: beforeFallback,
    afterTokens: afterFallback,
    tokensFreed: Math.max(0, beforeFallback - afterFallback),
  });

  const finalPromptTokens = afterFallback;
  const tokensFreed = steps.reduce((sum, step) => sum + step.tokensFreed, 0);

  return {
    messages: working,
    meta: {
      steps,
      tokensFreed,
      fallbackApplied,
      finalPromptTokens,
    },
  };
};
