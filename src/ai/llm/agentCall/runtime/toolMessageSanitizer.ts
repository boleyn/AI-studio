import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from '@aistudio/ai/compat/global/core/ai/type';
import { ChatCompletionRequestMessageRoleEnum } from '@aistudio/ai/compat/global/core/ai/constants';
import { addLog } from '@aistudio/ai/compat/common/system/log';

export const sanitizeToolMessagesByToolCalls = (
  messages: ChatCompletionMessageParam[]
): ChatCompletionMessageParam[] => {
  const seenToolCallIds = new Set<string>();
  const sanitized: ChatCompletionMessageParam[] = [];

  for (const message of messages) {
    if (message.role === ChatCompletionRequestMessageRoleEnum.Assistant) {
      const calls = (message as { tool_calls?: ChatCompletionMessageToolCall[] }).tool_calls;
      if (Array.isArray(calls)) {
        calls.forEach((call) => {
          if (call?.id) seenToolCallIds.add(call.id);
        });
      }
      sanitized.push(message);
      continue;
    }

    if (message.role === ChatCompletionRequestMessageRoleEnum.Tool) {
      const toolCallId = (message as { tool_call_id?: string }).tool_call_id;
      if (toolCallId && seenToolCallIds.has(toolCallId)) {
        sanitized.push(message);
      } else {
        addLog.warn('[LLM ToolMessage][drop-orphan-tool-result]', {
          tool_call_id: toolCallId || '',
          reason: 'tool_call_id_not_found_in_previous_assistant_tool_calls',
        });
      }
      continue;
    }

    sanitized.push(message);
  }

  return sanitized;
};
