import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool
} from './compat/global/core/ai/type';
import { getAxiosConfig } from './config';

const buildUrl = (baseUrl: string) => {
  const normalized = baseUrl.replace(/\/$/, '');
  if (normalized.endsWith('/v1')) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
};

export const createChatCompletion = async ({
  body,
  headers
}: {
  body: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming;
  headers?: Record<string, string>;
}) => {
  const { baseUrl, authorization } = getAxiosConfig();
  const response = await fetch(buildUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
      ...(headers || {})
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text().catch(() => '');
    throw new Error(error || `请求失败: ${response.status}`);
  }

  if ((body as ChatCompletionCreateParamsStreaming).stream) {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('空响应');
    }
    const decoder = new TextDecoder();
    const asyncIterable = {
      async *[Symbol.asyncIterator]() {
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            const lines = part.split('\n');
            const dataLines: string[] = [];
            for (const line of lines) {
              if (line.startsWith('data:')) {
                dataLines.push(line.replace('data:', '').trim());
              }
            }
            const data = dataLines.join('\n');
            if (!data || data === '[DONE]') continue;
            try {
              yield JSON.parse(data);
            } catch {
              continue;
            }
          }
        }
      }
    } as AsyncIterable<unknown> & { controller?: AbortController };
    return asyncIterable;
  }

  return response.json();
};

export const llmCompletionsBodyFormat = ({
  model,
  messages,
  tools,
  temperature,
  max_tokens,
  stream,
  tool_choice,
  parallel_tool_calls
}: {
  model: string;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tool_choice?: unknown;
  parallel_tool_calls?: boolean;
}) => {
  return {
    model,
    messages,
    tools,
    temperature,
    max_tokens,
    stream,
    tool_choice,
    parallel_tool_calls
  };
};
