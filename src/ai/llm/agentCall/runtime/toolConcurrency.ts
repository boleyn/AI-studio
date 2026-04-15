import type { ChatCompletionMessageToolCall } from '@aistudio/ai/compat/global/core/ai/type';

const CONCURRENCY_SAFE_TOOLS = new Set(['read', 'grep', 'compile_project']);
const CONCURRENCY_SAFE_GLOBAL_ACTIONS = new Set(['read', 'list', 'grep', 'search']);

const normalize = (value: unknown) => String(value || '').trim().toLowerCase();

const safeParseJson = (raw: string | undefined): Record<string, unknown> | undefined => {
  const text = String(raw || '').trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

export const isToolConcurrencySafe = (call: ChatCompletionMessageToolCall): boolean => {
  const toolName = normalize(call?.function?.name);
  if (!toolName) return false;

  if (CONCURRENCY_SAFE_TOOLS.has(toolName)) return true;

  if (toolName === 'global') {
    const parsed = safeParseJson(call?.function?.arguments);
    const action = normalize(parsed?.action);
    return CONCURRENCY_SAFE_GLOBAL_ACTIONS.has(action);
  }

  return false;
};
