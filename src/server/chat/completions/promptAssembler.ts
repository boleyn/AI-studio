import type { ChatCompletionMessageParam } from "@aistudio/ai/compat/global/core/ai/type";

export type PromptAssemblerInput = {
  coreSystemPrompts: ChatCompletionMessageParam[];
  contextMessages: ChatCompletionMessageParam[];
  taskConstraintPrompts?: ChatCompletionMessageParam[];
  memoryPrompts?: ChatCompletionMessageParam[];
};

export type PromptAssemblerOutput = {
  systemPrompts: ChatCompletionMessageParam[];
  contextMessages: ChatCompletionMessageParam[];
  messages: ChatCompletionMessageParam[];
  budgetMeta: {
    systemPromptCount: number;
    contextMessageCount: number;
    totalMessageCount: number;
  };
};

const normalizeSystemPrompt = (prompt: ChatCompletionMessageParam): ChatCompletionMessageParam | null => {
  if (!prompt || prompt.role !== "system") return null;
  const content =
    typeof (prompt as { content?: unknown }).content === "string"
      ? ((prompt as { content: string }).content || "").trim()
      : "";
  if (!content) return null;
  return {
    ...prompt,
    content,
  };
};

const dedupeSystemPrompts = (prompts: ChatCompletionMessageParam[]) => {
  const seen = new Set<string>();
  const output: ChatCompletionMessageParam[] = [];
  for (const prompt of prompts) {
    const normalized = normalizeSystemPrompt(prompt);
    if (!normalized) continue;
    const key = `${normalized.role}::${String(normalized.content)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
};

export const assemblePrompts = ({
  coreSystemPrompts,
  contextMessages,
  taskConstraintPrompts = [],
  memoryPrompts = [],
}: PromptAssemblerInput): PromptAssemblerOutput => {
  const systemPrompts = dedupeSystemPrompts([
    ...coreSystemPrompts,
    ...taskConstraintPrompts,
    ...memoryPrompts,
  ]);

  const messages = [...systemPrompts, ...contextMessages];
  return {
    systemPrompts,
    contextMessages,
    messages,
    budgetMeta: {
      systemPromptCount: systemPrompts.length,
      contextMessageCount: contextMessages.length,
      totalMessageCount: messages.length,
    },
  };
};
