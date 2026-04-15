import type { ToolHandlerResult } from './types';

export type SyntheticReason =
  | 'streaming_fallback'
  | 'sibling_error'
  | 'user_interrupted'
  | 'execution_error';

export const createSyntheticErrorResult = (
  reason: SyntheticReason,
  stop: boolean,
  params?: {
    erroredToolDescription?: string;
    message?: string;
  }
): ToolHandlerResult => {
  const content =
    reason === 'streaming_fallback'
      ? 'Streaming fallback - tool execution discarded'
      : reason === 'sibling_error'
        ? params?.erroredToolDescription
          ? `Cancelled: parallel tool call ${params.erroredToolDescription} errored`
          : 'Cancelled: parallel tool call errored'
        : reason === 'user_interrupted'
          ? 'User rejected tool use'
          : params?.message || 'Tool execution failed';

  return {
    response: `<tool_use_error>${content}</tool_use_error>`,
    assistantMessages: [],
    usages: [],
    stop,
    isError: true,
  };
};
