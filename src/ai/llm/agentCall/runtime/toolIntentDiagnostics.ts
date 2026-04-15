import type { ChatCompletionMessageParam } from '@aistudio/ai/compat/global/core/ai/type';
import { addLog } from '@aistudio/ai/compat/common/system/log';

const TOOL_INTENT_REGEX =
  /(\b(i\s*(am|'m)\s*(going to|about to|now)?\s*(call|use|run|invoke)\s*(a\s*)?(tool|function))\b|\b(i\s*(will|shall)\s*(call|use|run|invoke)\s*(a\s*)?(tool|function))\b|我(现在|将|会)?\s*(去|要)?\s*(调用|使用|执行)\s*(工具|函数))/i;

const messageToText = (message: ChatCompletionMessageParam): string => {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      if (record.type === 'text' && typeof record.text === 'string') return record.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

export const logToolIntentWithoutStructuredCall = ({
  model,
  finishReason,
  assistantMessages,
}: {
  model: string;
  finishReason: string | null | undefined;
  assistantMessages: ChatCompletionMessageParam[];
}) => {
  const text = assistantMessages
    .map(messageToText)
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!text) return;
  if (!TOOL_INTENT_REGEX.test(text)) return;

  addLog.warn('[LLM ToolCall][intent-without-structured-call]', {
    model,
    finish_reason: finishReason || '',
    snippet: text.slice(0, 240),
  });
};
