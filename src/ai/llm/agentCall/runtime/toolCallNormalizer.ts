import type { ChatCompletionMessageToolCall } from '@aistudio/ai/compat/global/core/ai/type';

const normalizeToolArgsForFingerprint = (raw: string | undefined) => {
  const value = (raw || '').trim();
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value.replace(/\s+/g, ' ');
  }
};

export const dedupeToolCallsInRound = (calls: ChatCompletionMessageToolCall[]) => {
  const seen = new Set<string>();
  const output: ChatCompletionMessageToolCall[] = [];

  calls.forEach((call) => {
    if (!call || !call.function?.name) return;
    const key = `${call.function.name.trim().toLowerCase()}::${normalizeToolArgsForFingerprint(
      call.function.arguments
    )}`;

    if (seen.has(key)) {
      console.info(
        '[agent-debug][tool-call-deduped]',
        JSON.stringify({
          toolCallId: call.id,
          toolName: call.function.name,
          argsLength: (call.function.arguments || '').length,
        })
      );
      return;
    }

    seen.add(key);
    output.push(call);
  });

  return output;
};
