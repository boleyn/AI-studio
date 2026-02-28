import type { ChatCompletionMessageParam, ChatCompletionTool } from '../../../global/core/ai/type';

const approxTokens = (text: string) => Math.ceil(text.length / 4);

export const countGptMessagesTokens = async (
  messages: ChatCompletionMessageParam[] = [],
  tools?: ChatCompletionTool[] | any
) => {
  let total = 0;
  for (const message of messages) {
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content || '');
    total += approxTokens(content);
    const maybeToolCalls = (message as { tool_calls?: unknown[] }).tool_calls;
    if (Array.isArray(maybeToolCalls) && maybeToolCalls.length > 0) {
      total += approxTokens(JSON.stringify(maybeToolCalls));
    }
  }
  if (tools) {
    total += approxTokens(JSON.stringify(tools));
  }
  return total;
};
