import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from '@aistudio/ai/compat/global/core/ai/type';
import { ChatCompletionRequestMessageRoleEnum } from '@aistudio/ai/compat/global/core/ai/constants';

const normalizeToolCallId = (value: unknown): string =>
  typeof value === 'string' ? value : '';

export const collectMissingToolResults = (
  messages: ChatCompletionMessageParam[]
): Array<{ toolCallId: string; toolName: string }> => {
  const pending = new Map<string, string>();

  for (const message of messages) {
    if (message.role === ChatCompletionRequestMessageRoleEnum.Assistant) {
      const calls = (message as { tool_calls?: ChatCompletionMessageToolCall[] }).tool_calls;
      if (!Array.isArray(calls)) continue;
      calls.forEach((call) => {
        const id = normalizeToolCallId(call?.id);
        if (!id) return;
        const name = String(call?.function?.name || 'tool');
        pending.set(id, name);
      });
      continue;
    }

    if (message.role === ChatCompletionRequestMessageRoleEnum.Tool) {
      const toolCallId = normalizeToolCallId((message as { tool_call_id?: unknown }).tool_call_id);
      if (!toolCallId) continue;
      pending.delete(toolCallId);
    }
  }

  return Array.from(pending.entries()).map(([toolCallId, toolName]) => ({
    toolCallId,
    toolName,
  }));
};

export const createSyntheticToolResultMessage = (
  toolCallId: string,
  reason: string
): ChatCompletionMessageParam => ({
  role: ChatCompletionRequestMessageRoleEnum.Tool,
  tool_call_id: toolCallId,
  content: `<tool_use_error>${reason}</tool_use_error>`,
});
