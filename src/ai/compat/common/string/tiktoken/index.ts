import type { ChatCompletionMessageParam, ChatCompletionTool } from '../../../global/core/ai/type';
import { countTokens } from 'gpt-tokenizer';

const safeStringify = (value: unknown) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const tokenLen = (value: unknown) => {
  const text = safeStringify(value);
  if (!text) return 0;
  try {
    return countTokens(text);
  } catch {
    return Math.ceil(text.length / 4);
  }
};

export const countGptMessagesTokens = async (
  messages: ChatCompletionMessageParam[] = [],
  tools?: ChatCompletionTool[] | any
) => {
  // ChatML structure overhead (estimate)
  let total = 3;
  for (const message of messages) {
    total += 4;
    total += tokenLen(message.role);
    total += tokenLen(message.content);
    const maybeName = (message as { name?: unknown }).name;
    if (maybeName) total += tokenLen(maybeName);
    const maybeToolCallId = (message as { tool_call_id?: unknown }).tool_call_id;
    if (maybeToolCallId) total += tokenLen(maybeToolCallId);
    const maybeToolCalls = (message as { tool_calls?: unknown[] }).tool_calls;
    if (Array.isArray(maybeToolCalls) && maybeToolCalls.length > 0) {
      total += tokenLen(maybeToolCalls);
    }
  }
  if (tools) {
    // Tool schemas also consume prompt tokens.
    total += 12 + tokenLen(tools);
  }
  return total;
};
