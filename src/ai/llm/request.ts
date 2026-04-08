import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  CompletionFinishReason,
  CompletionUsage,
  OpenAI,
  StreamChatType,
  UnStreamChatType
} from '@aistudio/ai/compat/global/core/ai/type';
import {
  computedTemperature,
  parseLLMStreamResponse,
  parseReasoningContent
} from '@aistudio/ai/utils';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { removeDatasetCiteText } from '@aistudio/ai/compat/global/core/ai/llm/utils';
import { getAIApi } from '@aistudio/ai/config';
import type { OpenaiAccountType } from '@aistudio/ai/compat/global/support/user/team/type';
import { getNanoid } from '@aistudio/ai/compat/global/common/string/tools';
import { getLLMModel } from '@aistudio/ai/model';
import { ChatCompletionRequestMessageRoleEnum } from '@aistudio/ai/compat/global/core/ai/constants';
import { countGptMessagesTokens } from '@aistudio/ai/compat/common/string/tiktoken/index';
import { loadRequestMessages } from './utils';
import { addLog } from '@aistudio/ai/compat/common/system/log';
import type { LLMModelItemType } from '@aistudio/ai/compat/global/core/ai/model.d';
import { i18nT } from '@aistudio/ai/compat/web/i18n/utils';
import { getErrText } from '@aistudio/ai/compat/global/common/error/utils';
import json5 from 'json5';

export type ResponseEvents = {
  onStreaming?: ({ text }: { text: string }) => void;
  onReasoning?: ({ text }: { text: string }) => void;
  onToolCall?: ({ call }: { call: ChatCompletionMessageToolCall }) => void;
  onToolParam?: ({ tool, params }: { tool: ChatCompletionMessageToolCall; params: string }) => void;
};

export type CreateLLMResponseProps<T extends CompletionsBodyType = CompletionsBodyType> = {
  throwError?: boolean;
  userKey?: OpenaiAccountType;
  body: LLMRequestBodyType<T>;
  isAborted?: () => boolean | undefined;
  custonHeaders?: Record<string, string>;
} & ResponseEvents;

const redactHeaderKeys = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'api-key']);
const sanitizeHeaders = (headers?: Record<string, any>) => {
  if (!headers) return;
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        redactHeaderKeys.has(key.toLowerCase()) ? '[REDACTED]' : String(value)
      ])
  );
};
const extractErrorResponseInfo = (error: any) => {
  const status = error?.status ?? error?.response?.status;
  const headers = error?.headers ?? error?.response?.headers;
  const data = error?.error ?? error?.response?.data ?? error?.data;
  const requestId =
    error?.request_id ??
    error?.response?.headers?.['x-request-id'] ??
    error?.headers?.['x-request-id'];

  return {
    status,
    headers: sanitizeHeaders(headers as Record<string, any>),
    data,
    requestId
  };
};

const inspectToolArguments = (raw: unknown) => {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  const trimmed = text.trim();
  const argsLength = trimmed.length;
  const argsTail = argsLength > 160 ? trimmed.slice(-160) : trimmed;
  const endsWithJsonCloser = /[}\]]\s*$/.test(trimmed);
  let jsonValid = false;
  if (trimmed) {
    try {
      JSON.parse(trimmed);
      jsonValid = true;
    } catch {
      jsonValid = false;
    }
  }
  const hasJsonOpen = trimmed.includes('{') || trimmed.includes('[');
  const likelyTruncated = Boolean(trimmed) && hasJsonOpen && !endsWithJsonCloser && !jsonValid;
  return {
    argsLength,
    argsTail,
    endsWithJsonCloser,
    jsonValid,
    likelyTruncated
  };
};

const sanitizeToolResultMessagesForProvider = (messages: ChatCompletionMessageParam[]) => {
  const toSafeToolArguments = (raw: unknown, toolCallId: string) => {
    const value = typeof raw === 'string' ? raw : String(raw ?? '');
    const trimmed = value.trim();
    if (!trimmed) return '{}';

    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      // Try to recover when concatenated fragments like `}{` appear.
      const objectStart = trimmed.indexOf('{');
      const objectEnd = trimmed.lastIndexOf('}');
      if (objectStart >= 0 && objectEnd > objectStart) {
        const candidate = trimmed.slice(objectStart, objectEnd + 1);
        try {
          JSON.parse(candidate);
          addLog.warn('[LLM Request][repair-tool-arguments-json]', {
            tool_call_id: toolCallId,
            strategy: 'extract-braced-json'
          });
          return candidate;
        } catch {
          // fall through
        }
      }
      const diagnosis = inspectToolArguments(trimmed);
      addLog.warn('[LLM Request][invalid-tool-arguments-json-fallback]', {
        tool_call_id: toolCallId,
        ...diagnosis
      });
      return '{}';
    }
  };

  const sanitized: ChatCompletionMessageParam[] = [];
  let i = 0;
  while (i < messages.length) {
    const message = messages[i];

    if (message.role !== 'assistant') {
      if (message.role === 'tool') {
        addLog.warn('[LLM Request][drop-orphan-tool-result-before-provider]', {
          tool_call_id: (message as { tool_call_id?: string }).tool_call_id || '',
          reason: 'tool_message_without_immediately_preceding_assistant_tool_calls'
        });
      } else {
        sanitized.push(message);
      }
      i += 1;
      continue;
    }

    const calls = (message as { tool_calls?: ChatCompletionMessageToolCall[] }).tool_calls;
    if (!Array.isArray(calls) || calls.length === 0) {
      sanitized.push(message);
      i += 1;
      continue;
    }

    const repairedCalls = calls
      .filter((call): call is ChatCompletionMessageToolCall => Boolean(call && call.id))
      .map((call) => {
        if (call.type !== 'function' || !call.function) return call;
        return {
          ...call,
          function: {
            ...call.function,
            arguments: toSafeToolArguments(call.function.arguments, call.id || '')
          }
        } as ChatCompletionMessageToolCall;
      });
    const dedupedCalls: ChatCompletionMessageToolCall[] = [];
    const seenCallIds = new Set<string>();
    for (const call of repairedCalls) {
      const id = call.id || '';
      if (!id) continue;
      if (seenCallIds.has(id)) {
        addLog.warn('[LLM Request][drop-duplicated-assistant-tool-call-before-provider]', {
          tool_call_id: id,
          reason: 'duplicated_tool_call_id_in_single_assistant_message'
        });
        continue;
      }
      seenCallIds.add(id);
      dedupedCalls.push(call);
    }

    const pendingIds = new Set(dedupedCalls.map((call) => call.id).filter(Boolean));
    const matchedToolIds = new Set<string>();
    const matchedToolMessages: ChatCompletionMessageParam[] = [];

    let j = i + 1;
    while (j < messages.length && messages[j].role === 'tool') {
      const toolMessage = messages[j] as ChatCompletionMessageParam & { tool_call_id?: string };
      const toolCallId = toolMessage.tool_call_id || '';
      if (toolCallId && pendingIds.has(toolCallId) && !matchedToolIds.has(toolCallId)) {
        matchedToolIds.add(toolCallId);
        matchedToolMessages.push(messages[j]);
      } else {
        addLog.warn('[LLM Request][drop-invalid-tool-result-before-provider]', {
          tool_call_id: toolCallId,
          reason: toolCallId
            ? 'tool_call_id_not_found_or_duplicated_in_immediately_preceding_assistant_tool_calls'
            : 'missing_tool_call_id'
        });
      }
      j += 1;
    }

    const finalCalls = dedupedCalls.filter((call) => matchedToolIds.has(call.id || ''));
    if (finalCalls.length > 0) {
      sanitized.push({
        ...message,
        tool_calls: finalCalls
      } as ChatCompletionMessageParam);
      sanitized.push(...matchedToolMessages);
    } else {
      const hasAssistantText = (() => {
        const content = (message as { content?: unknown }).content;
        if (typeof content === 'string') return content.trim().length > 0;
        if (Array.isArray(content)) return content.length > 0;
        return false;
      })();
      if (hasAssistantText) {
        const { tool_calls: _ignore, ...rest } = message as ChatCompletionMessageParam & {
          tool_calls?: ChatCompletionMessageToolCall[];
        };
        sanitized.push(rest as ChatCompletionMessageParam);
      } else {
        addLog.warn('[LLM Request][drop-incomplete-assistant-tool-call-before-provider]', {
          tool_call_count: repairedCalls.length,
          reason: 'assistant_tool_calls_without_following_tool_results'
        });
      }
    }

    i = j;
  }

  return sanitized;
};

type LLMResponse = {
  error?: any;
  isStreamResponse: boolean;
  answerText: string;
  reasoningText: string;
  toolCalls?: ChatCompletionMessageToolCall[];
  finish_reason: CompletionFinishReason;
  responseEmptyTip?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };

  requestMessages: ChatCompletionMessageParam[];
  assistantMessage: ChatCompletionMessageParam[];
  completeMessages: ChatCompletionMessageParam[];
};

/*
  底层封装 LLM 调用 帮助上层屏蔽 stream 和非 stream，以及 toolChoice 和 promptTool 模式。
  工具调用无论哪种模式，都存 toolChoice 的格式，promptTool 通过修改 toolChoice 的结构，形成特定的 messages 进行调用。
*/
export const createLLMResponse = async <T extends CompletionsBodyType>(
  args: CreateLLMResponseProps<T>
): Promise<LLMResponse> => {
  const { throwError = true, body, custonHeaders, userKey } = args;
  const { messages, useVision, requestOrigin, tools, toolCallMode, aiChatPromptCache } = body;

  // Messages process
  const requestMessages = await loadRequestMessages({
    messages,
    useVision,
    origin: requestOrigin
  });
  try {
    console.info(
      '[llm-debug][after-loadRequestMessages]',
      JSON.stringify(
        {
          model: body.model,
          useVision: !!useVision,
          messageCount: requestMessages.length
        },
        null,
        2
      )
    );
  } catch (error) {
    console.warn('[llm-debug][after-loadRequestMessages] serialize_failed', getErrText(error));
  }
  // Message process
  const rewriteMessages = requestMessages;

  const cacheControlMessages = (() => {
    if (!aiChatPromptCache) return rewriteMessages;
    if (!Array.isArray(rewriteMessages) || rewriteMessages.length === 0) return rewriteMessages;

    const attachCacheControl = (parts: any[]) => {
      if (parts.some((part) => part && typeof part === 'object' && 'cache_control' in part)) {
        return parts;
      }
      if (parts.length === 0) {
        return [{ type: 'text', text: '', cache_control: { type: 'ephemeral' } }];
      }
      const lastIndex = parts.length - 1;
      const last = parts[lastIndex];
      if (last && typeof last === 'object' && !('cache_control' in last)) {
        const updated = [...parts];
        updated[lastIndex] = {
          ...last,
          cache_control: { type: 'ephemeral' }
        };
        return updated;
      }
      return parts;
    };

    const messages = [...rewriteMessages];

    // 1. 找到最后一个 system 消息，添加 cache_control
    let lastSystemIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === ChatCompletionRequestMessageRoleEnum.System) {
        lastSystemIndex = i;
        break;
      }
    }

    if (lastSystemIndex >= 0) {
      const lastSystemMessage = messages[lastSystemIndex];
      const systemContent = (lastSystemMessage as any)?.content;

      if (typeof systemContent === 'string') {
        messages[lastSystemIndex] = {
          ...lastSystemMessage,
          content: attachCacheControl([{ type: 'text', text: systemContent }])
        } as ChatCompletionMessageParam;
      } else if (Array.isArray(systemContent)) {
        messages[lastSystemIndex] = {
          ...lastSystemMessage,
          content: attachCacheControl(systemContent)
        } as ChatCompletionMessageParam;
      }
    }

    // 2. 在 messages 数组的最后一个消息上添加 cache_control
    const lastMessageIndex = messages.length - 1;
    const lastMessage = messages[lastMessageIndex];

    if (lastMessage && lastMessageIndex !== lastSystemIndex) {
      // 只有当最后一个消息不是 system 消息时才处理（避免重复处理）
      const content = (lastMessage as any)?.content;

      if (typeof content === 'string') {
        messages[lastMessageIndex] = {
          ...lastMessage,
          content: attachCacheControl([{ type: 'text', text: content }])
        } as ChatCompletionMessageParam;
      } else if (Array.isArray(content)) {
        messages[lastMessageIndex] = {
          ...lastMessage,
          content: attachCacheControl(content)
        } as ChatCompletionMessageParam;
      }
    }

    return messages;
  })();

  const { requestBody, modelData } = await llmCompletionsBodyFormat({
    ...body,
    messages: cacheControlMessages
  });
  try {
    console.info(
      '[llm-debug][before-createChatCompletion]',
      JSON.stringify(
        {
          model: requestBody.model,
          stream: requestBody.stream,
          temperature: requestBody.temperature,
          top_p: requestBody.top_p,
          tool_choice: requestBody.tool_choice,
          toolCallMode: body.toolCallMode,
          messageCount: Array.isArray(requestBody.messages) ? requestBody.messages.length : 0,
          toolCount: Array.isArray(requestBody.tools) ? requestBody.tools.length : 0
        },
        null,
        2
      )
    );
  } catch (error) {
    console.warn('[llm-debug][before-createChatCompletion] serialize_failed', getErrText(error));
  }

  // console.log(JSON.stringify(requestBody, null, 2));
  const { response, isStreamResponse, requestMeta } = await createChatCompletion({
    body: requestBody,
    modelData,
    userKey,
    options: {
      headers: {
        Accept: 'application/json, text/plain, */*',
        ...custonHeaders
      }
    }
  });

  let { answerText, reasoningText, toolCalls, finish_reason, usage, error } = await (async () => {
    if (isStreamResponse) {
      return createStreamResponse({
        response,
        body,
        isAborted: args.isAborted,
        onStreaming: args.onStreaming,
        onReasoning: args.onReasoning,
        onToolCall: args.onToolCall,
        onToolParam: args.onToolParam
      });
    } else {
      return createCompleteResponse({
        response,
        body,
        onStreaming: args.onStreaming,
        onReasoning: args.onReasoning,
        onToolCall: args.onToolCall
      });
    }
  })();

  const assistantMessage: ChatCompletionMessageParam[] = [
    ...(answerText || reasoningText
      ? [
          ({
            role: ChatCompletionRequestMessageRoleEnum.Assistant as 'assistant',
            content: answerText,
            reasoning_text: reasoningText
          } as any)
        ]
      : []),
    ...(toolCalls?.length
      ? [
          {
            role: ChatCompletionRequestMessageRoleEnum.Assistant as 'assistant',
            tool_calls: toolCalls
          }
        ]
      : [])
  ];

  // Usage count
  const inputTokens =
    usage?.prompt_tokens || (await countGptMessagesTokens(requestBody.messages, requestBody.tools));
  const outputTokens = usage?.completion_tokens || (await countGptMessagesTokens(assistantMessage));

  if (error) {
    finish_reason = 'stop';

    if (throwError) {
      throw error;
    }
  }

  const getEmptyResponseTip = () => {
    if (userKey?.baseUrl) {
      addLog.warn(`User LLM response empty`, {
        request: {
          baseUrl: requestMeta?.baseUrl || userKey?.baseUrl,
          path: requestMeta?.path,
          headers: requestMeta?.headers,
          body: requestBody
        },
        response: isStreamResponse ? undefined : response,
        finish_reason
      });
      return `您的 API key 没有响应: ${JSON.stringify(body)}`;
    } else {
      addLog.error(`LLM response empty`, {
        message: '',
        request: {
          baseUrl: requestMeta?.baseUrl,
          path: requestMeta?.path,
          headers: requestMeta?.headers,
          body: requestBody
        },
        response: isStreamResponse ? undefined : response,
        finish_reason
      });
    }
    return i18nT('chat:LLM_model_response_empty');
  };
  const isNotResponse =
    !answerText &&
    !reasoningText &&
    !toolCalls?.length &&
    !error &&
    (finish_reason === 'stop' || !finish_reason);
  const responseEmptyTip = isNotResponse ? getEmptyResponseTip() : undefined;

  return {
    error,
    isStreamResponse,
    responseEmptyTip,
    answerText,
    reasoningText,
    toolCalls,
    finish_reason,
    usage: {
      inputTokens: error ? 0 : inputTokens,
      outputTokens: error ? 0 : outputTokens
    },

    requestMessages,
    assistantMessage,
    completeMessages: [...requestMessages, ...assistantMessage]
  };
};

type CompleteParams = Pick<CreateLLMResponseProps<CompletionsBodyType>, 'body'> & ResponseEvents;

type CompleteResponse = Pick<
  LLMResponse,
  'answerText' | 'reasoningText' | 'toolCalls' | 'finish_reason'
> & {
  usage?: CompletionUsage;
  error?: any;
};

export const createStreamResponse = async ({
  body,
  response,
  isAborted,
  onStreaming,
  onReasoning,
  onToolCall,
  onToolParam
}: CompleteParams & {
  response: StreamChatType;
  isAborted?: () => boolean | undefined;
}): Promise<CompleteResponse> => {
  const { retainDatasetCite = true, tools, toolCallMode = 'toolChoice', model } = body;
  const modelData = getLLMModel(String(model));

  const { parsePart, getResponseData, updateFinishReason, updateError } = parseLLMStreamResponse();

  if (tools?.length) {
    const toChunkText = (value: unknown) => {
      if (typeof value === 'string') return value;
      if (value == null) return '';
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value);
        } catch {
          return '';
        }
      }
      return String(value);
    };
    const stripDefaultApiPrefix = (name: string) =>
      name.startsWith('default_api:') ? name.slice('default_api:'.length) : name;
    const pendingTools = new Map<number, {
      id?: string;
      name: string;
      arguments: string;
    }>();
    const toolCalls: ChatCompletionMessageToolCall[] = [];

    try {
      for await (const part of response) {
        if (isAborted?.()) {
          response.controller?.abort();
          updateFinishReason('stop');
          break;
        }

        const { reasoningContent, responseContent } = parsePart({
          part,
          parseThinkTag: (modelData as any).reasoning,
          retainDatasetCite
        });

        if (reasoningContent) {
          onReasoning?.({ text: reasoningContent });
        }
        if (responseContent) {
          onStreaming?.({ text: responseContent });
        }

        const responseChoice = part.choices?.[0]?.delta;

        if (responseChoice?.tool_calls?.length) {
          responseChoice.tool_calls.forEach((toolCall: any, i: number) => {
            const index = toolCall.index ?? i;
            const argChunk = toChunkText(toolCall?.function?.arguments);
            const nameChunk = toChunkText(toolCall?.function?.name);
            const existingPending = pendingTools.get(index) || {
              id: undefined,
              name: '',
              arguments: ''
            };
            if (!existingPending.id && typeof toolCall?.id === 'string' && toolCall.id) {
              existingPending.id = toolCall.id;
            }
            if (nameChunk) existingPending.name += nameChunk;
            if (argChunk) existingPending.arguments += argChunk;
            pendingTools.set(index, existingPending);

            const currentTool = toolCalls[index];
            if (currentTool) {
              if (
                argChunk &&
                currentTool.type === 'function' &&
                'function' in currentTool &&
                currentTool.function
              ) {
                const toolWithFunction = currentTool as ChatCompletionMessageToolCall & {
                  type: 'function';
                  function: { name: string; arguments: string };
                };
                toolWithFunction.function.arguments += argChunk;
                onToolParam?.({ tool: currentTool, params: argChunk });
              }
              return;
            }

            const toolName = existingPending.name;
            if (!toolName) return;

            const normalizedToolName = stripDefaultApiPrefix(toolName);
            const filteredTools = tools.filter(
              (
                item
              ): item is ChatCompletionTool & {
                type: 'function';
                function: { name: string; description?: string; parameters?: any };
              } => {
                return (
                  item.type === 'function' && 'function' in item && item.function !== undefined
                );
              }
            );
            const matchTool =
              filteredTools.find((item) => item.function.name === toolName) ||
              filteredTools.find((item) => item.function.name === normalizedToolName);
            if (!matchTool) return;

            const resolvedToolName = matchTool.function.name;
            const bufferedArgs = existingPending.arguments;
            const call: ChatCompletionMessageToolCall = {
              id: existingPending.id || getNanoid(),
              type: 'function',
              function: {
                // Always emit the canonical local tool name so executor can resolve it reliably.
                name: resolvedToolName,
                arguments: bufferedArgs
              } as ChatCompletionMessageToolCall['function']
            };
            addLog.info('[LLM ToolCall][stream]', {
              id: call.id,
              name: call.function?.name,
              model: String(model),
              argsLength: call.function?.arguments?.length || 0
            });
            toolCalls[index] = call;
            onToolCall?.({ call });
            // Emit buffered argument prefix collected before tool name was fully resolved.
            if (bufferedArgs) {
              onToolParam?.({ tool: call, params: bufferedArgs });
            }
            // call 已创建后，arguments 的后续分片由 onToolParam 继续追加。
            existingPending.arguments = '';
            pendingTools.set(index, existingPending);
          });
        }
      }
    } catch (error: any) {
      const streamError = error?.error || error;
      // Some providers may terminate stream with a transport-level error after tool calls
      // were already emitted. Preserve those tool calls to avoid "tool started but no output".
      if (toolCalls.filter((call) => !!call).length > 0) {
        addLog.warn('[LLM ToolCall][stream][ignore-error-after-toolcall]', {
          message: getErrText(streamError),
          toolCallCount: toolCalls.filter((call) => !!call).length
        });
      } else {
        updateError(streamError);
      }
    }

    const { reasoningContent, content, finish_reason, usage, error } = getResponseData();
    addLog.info('[LLM ToolCall][stream][summary]', {
      model: String(model),
      toolCallCount: toolCalls.filter((call) => !!call).length,
      toolCalls: toolCalls
        .filter((call): call is ChatCompletionMessageToolCall => Boolean(call))
        .map((call) => ({
          id: call.id,
          name: call.function?.name,
          ...inspectToolArguments(call.function?.arguments)
        })),
      finish_reason
    });

    return {
      error,
      answerText: content,
      reasoningText: reasoningContent,
      finish_reason,
      usage,
      toolCalls: toolCalls.filter((call) => !!call)
    };
  } else {
    // Not use tool
    try {
      for await (const part of response) {
        if (isAborted?.()) {
          response.controller?.abort();
          updateFinishReason('stop');
          break;
        }

        const { reasoningContent, responseContent } = parsePart({
          part,
          parseThinkTag: (modelData as any).reasoning,
          retainDatasetCite
        });

        if (reasoningContent) {
          onReasoning?.({ text: reasoningContent });
        }
        if (responseContent) {
          onStreaming?.({ text: responseContent });
        }
      }
    } catch (error: any) {
      updateError(error?.error || error);
    }

    const { reasoningContent, content, finish_reason, usage, error } = getResponseData();

    return {
      error,
      answerText: content,
      reasoningText: reasoningContent,
      finish_reason,
      usage
    };
  }
};

export const createCompleteResponse = async ({
  body,
  response,
  onStreaming,
  onReasoning,
  onToolCall
}: CompleteParams & { response: ChatCompletion }): Promise<CompleteResponse> => {
  const { tools, retainDatasetCite = true } = body;
  const modelData = getLLMModel(String(body.model));

  const finish_reason = response.choices?.[0]?.finish_reason as CompletionFinishReason;
  const usage = response.usage;

  // Content and think parse
  const { content, reasoningContent } = (() => {
    const content = response.choices?.[0]?.message?.content || '';
    const reasoningContent: string =
      (response.choices?.[0]?.message as any)?.reasoning_content || '';

    // API already parse reasoning content
    if (reasoningContent || !(modelData as any).reasoning) {
      return {
        content,
        reasoningContent
      };
    }

    const [think, answer] = parseReasoningContent(content);
    return {
      content: answer,
      reasoningContent: think
    };
  })();
  const formatReasonContent = (removeDatasetCiteText as any)(reasoningContent, retainDatasetCite);
  let formatContent = (removeDatasetCiteText as any)(content, retainDatasetCite);

  // Tool parse
  const { toolCalls } = (() => {
    if (tools?.length) {
      return {
        toolCalls: response.choices?.[0]?.message?.tool_calls || []
      };
    }

    return {
      toolCalls: undefined
    };
  })();

  // Event response
  if (formatReasonContent) {
    onReasoning?.({ text: formatReasonContent });
  }
  if (formatContent) {
    onStreaming?.({ text: formatContent });
  }
  if (toolCalls?.length) {
    toolCalls.forEach((call) => {
      addLog.info('[LLM ToolCall][complete]', {
        id: call.id,
        name: call.function?.name
      });
    });
  }
  if (toolCalls?.length && onToolCall) {
    toolCalls.forEach((call) => {
      onToolCall({ call });
    });
  }

  return {
    error: (response as any).error,
    reasoningText: formatReasonContent,
    answerText: formatContent,
    toolCalls,
    finish_reason,
    usage
  };
};

type CompletionsBodyType =
  | ChatCompletionCreateParamsNonStreaming
  | ChatCompletionCreateParamsStreaming;
type InferCompletionsBody<T> = T extends { stream: true }
  ? ChatCompletionCreateParamsStreaming
  : T extends { stream: false }
    ? ChatCompletionCreateParamsNonStreaming
    : ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming;

type LLMRequestBodyType<T> = Omit<
  T,
  | 'model'
  | 'stop'
  | 'response_format'
  | 'messages'
  | 'tools'
  | 'tool_choice'
  | 'parallel_tool_calls'
> & {
  model: string | LLMModelItemType;
  stop?: string;
  response_format?: {
    type?: string;
    json_schema?: string;
  };
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  tool_choice?: any;
  parallel_tool_calls?: boolean;

  // Custom field
  retainDatasetCite?: boolean;
  toolCallMode?: 'toolChoice';
  useVision?: boolean;
  aiChatPromptCache?: boolean;
  requestOrigin?: string;
};
export const llmCompletionsBodyFormat = async <T extends CompletionsBodyType>({
  retainDatasetCite,
  useVision,
  requestOrigin,
  aiChatPromptCache,

  tools,
  tool_choice,
  parallel_tool_calls,
  toolCallMode,
  ...body
}: LLMRequestBodyType<T>): Promise<{
  requestBody: InferCompletionsBody<T>;
  modelData: LLMModelItemType;
}> => {
  const modelData = getLLMModel(body.model);
  if (!modelData) {
    return {
      requestBody: body as unknown as InferCompletionsBody<T>,
      modelData
    };
  }

  const response_format = (() => {
    if (!body.response_format?.type) return undefined;
    if (body.response_format.type === 'json_schema') {
      try {
        return {
          type: 'json_schema',
          json_schema: json5.parse(body.response_format?.json_schema as unknown as string)
        };
      } catch (error) {
        throw new Error('Json schema error');
      }
    }
    if (body.response_format.type) {
      return {
        type: body.response_format.type
      };
    }
    return undefined;
  })();
  const stop = body.stop ?? undefined;

  const formatStop = stop?.split('|').filter((item) => !!item.trim());
  let requestBody = ({
    ...body,
    model: modelData.model,
    temperature:
      typeof body.temperature === 'number'
        ? computedTemperature({
            model: modelData,
            temperature: body.temperature
          })
        : undefined,
    response_format,
    stop: formatStop?.length ? formatStop : undefined,
    ...(toolCallMode === 'toolChoice' && {
      tools,
      tool_choice,
      parallel_tool_calls
    })
  } as unknown) as T;

  // Filter undefined/null value
  requestBody = Object.fromEntries(
    Object.entries(requestBody).filter(([_, value]) => value !== null && value !== undefined)
  ) as T;

  // field map
  if (modelData.fieldMap) {
    Object.entries(modelData.fieldMap).forEach(([sourceKey, targetKey]) => {
      // @ts-ignore
      requestBody[targetKey] = body[sourceKey];
      // @ts-ignore
      delete requestBody[sourceKey];
    });
  }

  requestBody = {
    ...requestBody,
    ...modelData?.defaultConfig
  };

  return {
    requestBody: requestBody as unknown as InferCompletionsBody<T>,
    modelData
  };
};

const resolveModelProtocol = (modelData: LLMModelItemType) => {
  const protocol = String((modelData as { protocol?: unknown }).protocol || '')
    .trim()
    .toLowerCase();
  return !protocol || protocol === 'openai' ? 'openai' : protocol;
};

const toGoogleFinishReason = (reason: unknown): CompletionFinishReason => {
  const value = String(reason || '').trim().toUpperCase();
  switch (value) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
      return 'content_filter';
    default:
      return null;
  }
};

const toAnthropicFinishReason = (reason: unknown): CompletionFinishReason => {
  switch (reason) {
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'stop_sequence':
      return 'stop';
    default:
      return null;
  }
};

const toAnthropicText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      if (record.type === 'text') return typeof record.text === 'string' ? record.text : '';
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

const parseToolInput = (raw: unknown) => {
  if (raw && typeof raw === 'object') return raw;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  return {};
};

const toAnthropicMessages = (messages: ChatCompletionMessageParam[]) => {
  const systemParts: string[] = [];
  const output: Array<{ role: 'user' | 'assistant'; content: unknown[] }> = [];
  const pushMessage = (role: 'user' | 'assistant', blocks: unknown[]) => {
    if (blocks.length === 0) return;
    const last = output[output.length - 1];
    if (last && last.role === role) {
      last.content.push(...blocks);
      return;
    }
    output.push({ role, content: blocks });
  };

  messages.forEach((message) => {
    if (!message || typeof message !== 'object') return;
    if (message.role === 'system') {
      const text = toAnthropicText((message as { content?: unknown }).content);
      if (text.trim()) systemParts.push(text);
      return;
    }

    if (message.role === 'user') {
      const text = toAnthropicText((message as { content?: unknown }).content);
      pushMessage('user', text ? [{ type: 'text', text }] : []);
      return;
    }

    if (message.role === 'assistant') {
      const blocks: unknown[] = [];
      const text = toAnthropicText((message as { content?: unknown }).content);
      if (text) blocks.push({ type: 'text', text });

      const toolCalls = (message as { tool_calls?: ChatCompletionMessageToolCall[] }).tool_calls;
      if (Array.isArray(toolCalls)) {
        toolCalls.forEach((call) => {
          const id = typeof call?.id === 'string' && call.id ? call.id : getNanoid();
          const name =
            typeof call?.function?.name === 'string' && call.function.name
              ? call.function.name
              : 'tool';
          blocks.push({
            type: 'tool_use',
            id,
            name,
            input: parseToolInput(call?.function?.arguments),
          });
        });
      }
      pushMessage('assistant', blocks);
      return;
    }

    if (message.role === 'tool') {
      const toolCallId =
        typeof (message as { tool_call_id?: unknown }).tool_call_id === 'string'
          ? ((message as { tool_call_id?: string }).tool_call_id as string)
          : '';
      if (!toolCallId) return;
      pushMessage('user', [
        {
          type: 'tool_result',
          tool_use_id: toolCallId,
          content: toAnthropicText((message as { content?: unknown }).content),
        },
      ]);
    }
  });

  return {
    system: systemParts.join('\n\n').trim(),
    messages: output,
  };
};

const toAnthropicTools = (tools?: ChatCompletionTool[]) => {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const strictToolUseEnabled = process.env.ANTHROPIC_STRICT_TOOL_USE !== "0";
  const mapped = tools
    .filter((tool) => tool?.type === 'function' && tool.function)
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description || '',
      ...(strictToolUseEnabled ? { strict: true } : {}),
      input_schema:
        tool.function.parameters && typeof tool.function.parameters === 'object'
          ? tool.function.parameters
          : { type: 'object', properties: {} },
    }));
  return mapped.length > 0 ? mapped : undefined;
};

const toAnthropicToolChoice = (toolChoice: unknown) => {
  if (toolChoice === 'required') return { type: 'any' };
  if (toolChoice === 'auto' || toolChoice == null) return { type: 'auto' };
  if (typeof toolChoice === 'object' && toolChoice) {
    const fnName = (toolChoice as { function?: { name?: unknown } }).function?.name;
    if (typeof fnName === 'string' && fnName.trim()) {
      return { type: 'tool', name: fnName.trim() };
    }
  }
  return { type: 'auto' };
};

const createAnthropicRequestBody = (
  body: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming
) => {
  const safeMessages = Array.isArray(body.messages)
    ? sanitizeToolResultMessagesForProvider(body.messages)
    : [];
  const converted = toAnthropicMessages(safeMessages);
  const tools = toAnthropicTools(body.tools);
  const toolChoice = tools ? toAnthropicToolChoice((body as { tool_choice?: unknown }).tool_choice) : undefined;
  const maxTokens =
    typeof body.max_tokens === 'number' && Number.isFinite(body.max_tokens) && body.max_tokens > 0
      ? Math.floor(body.max_tokens)
      : 4096;

  return {
    model: body.model,
    max_tokens: maxTokens,
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    stream: body.stream === true,
    thinking:
      (body as { thinking?: unknown }).thinking &&
      typeof (body as { thinking?: unknown }).thinking === 'object'
        ? (body as { thinking?: unknown }).thinking
        : undefined,
    ...(converted.system ? { system: converted.system } : {}),
    messages: converted.messages,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
  };
};

const createAnthropicStreamResponse = (
  stream: AsyncIterable<unknown>,
  created: number,
  model: string,
  onDone: () => void
) => {
  const pendingTools = new Map<number, { id?: string; name?: string; arguments: string; started: boolean }>();
  let promptTokens = 0;
  let completionTokens = 0;

  const makeChunk = (delta: Record<string, unknown>, finishReason: CompletionFinishReason = null) =>
    ({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      usage:
        promptTokens || completionTokens
          ? {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
            }
          : undefined,
    }) as unknown;

  const iterable = {
    async *[Symbol.asyncIterator]() {
      try {
        for await (const streamEvent of stream) {
          const event = streamEvent as any;
          if (!event || typeof event !== 'object') continue;

          if (event?.type === 'message_start') {
            promptTokens = Number(event?.message?.usage?.input_tokens || 0);
            continue;
          }
          if (event?.type === 'content_block_start') {
            const block = event?.content_block;
            if (block?.type === 'tool_use') {
              pendingTools.set(Number(event.index || 0), {
                id: typeof block.id === 'string' ? block.id : getNanoid(),
                name: typeof block.name === 'string' ? block.name : '',
                arguments: '',
                started: false,
              });
            }
            continue;
          }
          if (event?.type === 'content_block_delta') {
            const deltaType = event?.delta?.type;
            if (deltaType === 'text_delta' && typeof event?.delta?.text === 'string') {
              yield makeChunk({ content: event.delta.text });
              continue;
            }
            if (deltaType === 'thinking_delta' && typeof event?.delta?.thinking === 'string') {
              yield makeChunk({ reasoning_content: event.delta.thinking });
              continue;
            }
            if (deltaType === 'input_json_delta') {
              const index = Number(event.index || 0);
              const tool = pendingTools.get(index);
              if (!tool) continue;
              const partial = String(event?.delta?.partial_json || '');
              tool.arguments += partial;
              const toolDelta = tool.started
                ? {
                    tool_calls: [
                      {
                        index,
                        function: { arguments: partial },
                      },
                    ],
                  }
                : {
                    tool_calls: [
                      {
                        index,
                        id: tool.id,
                        type: 'function',
                        function: {
                          name: tool.name || '',
                          arguments: partial,
                        },
                      },
                    ],
                  };
              tool.started = true;
              pendingTools.set(index, tool);
              yield makeChunk(toolDelta);
            }
            continue;
          }
          if (event?.type === 'message_delta') {
            completionTokens = Number(event?.usage?.output_tokens || completionTokens || 0);
            const finishReason = toAnthropicFinishReason(event?.delta?.stop_reason);
            if (finishReason) {
              yield makeChunk({}, finishReason);
            }
            continue;
          }
          if (event?.type === 'error') {
            yield ({
              error: event?.error || event,
              choices: [{ delta: {}, finish_reason: 'error' }],
            } as unknown);
          }
        }
      } finally {
        onDone();
      }
    },
  } as AsyncIterable<unknown> & { controller?: AbortController };

  return iterable;
};

const createAnthropicChatCompletion = async ({
  modelData,
  body,
  timeout,
  options,
}: {
  modelData: LLMModelItemType;
  body: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming;
  timeout?: number;
  options?: OpenAI.RequestOptions;
}) => {
  const rawBaseUrl = String((modelData as { baseUrl?: unknown }).baseUrl || '').trim();
  const apiKey = String((modelData as { key?: unknown }).key || '').trim();
  if (!rawBaseUrl) {
    throw new Error('Anthropic 协议模型缺少 baseUrl 配置');
  }
  if (!apiKey) {
    throw new Error('Anthropic 协议模型缺少 key 配置');
  }

  const baseUrl = rawBaseUrl.replace(/\/$/, '');
  const requestBody = createAnthropicRequestBody(body);
  const requestHeaders = {
    'anthropic-version': '2023-06-01',
    ...(options?.headers || {}),
  } as Record<string, string>;
  const client = new Anthropic({
    apiKey,
    baseURL: baseUrl,
    timeout: timeout ? timeout : 600000,
    maxRetries: 2,
    defaultHeaders: requestHeaders,
  });
  const formatTimeout = timeout ? timeout : 600000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), formatTimeout);
  let keepTimerForStream = false;

  try {
    const requestMeta = {
      baseUrl,
      path: '/v1/messages',
      headers: sanitizeHeaders(requestHeaders) as Record<string, string>,
    };

    if (requestBody.stream) {
      const stream = (await client.messages.create(
        requestBody as any,
        {
          signal: controller.signal,
          timeout: formatTimeout,
        }
      )) as AsyncIterable<unknown>;
      keepTimerForStream = true;
      const streamResponse = createAnthropicStreamResponse(
        stream,
        Math.floor(Date.now() / 1000),
        String(body.model || modelData.model),
        () => clearTimeout(timer)
      ) as StreamChatType;
      streamResponse.controller = controller;
      return {
        response: streamResponse,
        isStreamResponse: true as const,
        requestMeta,
      };
    }

    const json = (await client.messages.create(requestBody as any, {
      signal: controller.signal,
      timeout: formatTimeout,
    })) as any;
    const text = Array.isArray(json?.content)
      ? json.content
          .filter((item: any) => item?.type === 'text' && typeof item?.text === 'string')
          .map((item: any) => item.text)
          .join('\n')
      : '';
    const reasoning = Array.isArray(json?.content)
      ? json.content
          .filter((item: any) => item?.type === 'thinking' && typeof item?.thinking === 'string')
          .map((item: any) => item.thinking)
          .join('\n')
      : '';
    const toolCalls = Array.isArray(json?.content)
      ? json.content
          .filter((item: any) => item?.type === 'tool_use')
          .map((item: any) => ({
            id: typeof item.id === 'string' && item.id ? item.id : getNanoid(),
            type: 'function',
            function: {
              name: typeof item.name === 'string' ? item.name : '',
              arguments: JSON.stringify(item.input || {}),
            },
          }))
      : [];

    const completion = {
      id: json?.id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: String(body.model || modelData.model),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: text,
            ...(reasoning ? { reasoning_content: reasoning } : {}),
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: toAnthropicFinishReason(json?.stop_reason),
        },
      ],
      usage: {
        prompt_tokens: Number(json?.usage?.input_tokens || 0),
        completion_tokens: Number(json?.usage?.output_tokens || 0),
        total_tokens:
          Number(json?.usage?.input_tokens || 0) + Number(json?.usage?.output_tokens || 0),
      },
    } as unknown as UnStreamChatType;

    return {
      response: completion,
      isStreamResponse: false as const,
      requestMeta,
    };
  } finally {
    if (!keepTimerForStream) {
      clearTimeout(timer);
    }
  }
};

const toGoogleTools = (tools?: ChatCompletionTool[]) => {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const declarations = tools
    .filter((tool) => tool?.type === 'function' && tool.function)
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description || '',
      parametersJsonSchema:
        tool.function.parameters && typeof tool.function.parameters === 'object'
          ? tool.function.parameters
          : { type: 'object', properties: {} },
    }));
  if (declarations.length === 0) return undefined;
  return [{ functionDeclarations: declarations }];
};

const toGoogleToolConfig = (toolChoice: unknown, hasTools: boolean) => {
  if (!hasTools) return undefined;
  if (toolChoice === 'required') {
    return {
      functionCallingConfig: {
        mode: 'ANY',
      },
    };
  }
  if (typeof toolChoice === 'object' && toolChoice) {
    const fnName = (toolChoice as { function?: { name?: unknown } }).function?.name;
    if (typeof fnName === 'string' && fnName.trim()) {
      return {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: [fnName.trim()],
        },
      };
    }
  }
  return {
    functionCallingConfig: {
      mode: 'AUTO',
    },
  };
};

const toGoogleMessages = (messages: ChatCompletionMessageParam[]) => {
  const safeMessages = sanitizeToolResultMessagesForProvider(messages);
  const systemParts: string[] = [];
  const output: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = [];
  const toolNameByCallId = new Map<string, string>();

  const pushMessage = (role: 'user' | 'model', parts: Array<Record<string, unknown>>) => {
    if (parts.length === 0) return;
    output.push({ role, parts });
  };

  safeMessages.forEach((message) => {
    if (!message || typeof message !== 'object') return;
    if (message.role === 'system') {
      const text = toAnthropicText((message as { content?: unknown }).content);
      if (text.trim()) systemParts.push(text);
      return;
    }
    if (message.role === 'user') {
      const text = toAnthropicText((message as { content?: unknown }).content);
      pushMessage('user', text ? [{ text }] : []);
      return;
    }
    if (message.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      const text = toAnthropicText((message as { content?: unknown }).content);
      if (text) parts.push({ text });
      const toolCalls = (message as { tool_calls?: ChatCompletionMessageToolCall[] }).tool_calls;
      if (Array.isArray(toolCalls)) {
        toolCalls.forEach((call) => {
          const id = typeof call?.id === 'string' ? call.id : '';
          const name = typeof call?.function?.name === 'string' ? call.function.name : 'tool';
          if (id) toolNameByCallId.set(id, name);
          parts.push({
            functionCall: {
              name,
              args: parseToolInput(call?.function?.arguments),
            },
          });
        });
      }
      pushMessage('model', parts);
      return;
    }
    if (message.role === 'tool') {
      const toolCallId =
        typeof (message as { tool_call_id?: unknown }).tool_call_id === 'string'
          ? ((message as { tool_call_id?: string }).tool_call_id as string)
          : '';
      if (!toolCallId) return;
      const name = toolNameByCallId.get(toolCallId) || 'tool';
      const text = toAnthropicText((message as { content?: unknown }).content);
      let responsePayload: unknown = { result: text };
      if (text.trim()) {
        try {
          responsePayload = JSON.parse(text);
        } catch {
          responsePayload = { result: text };
        }
      }
      pushMessage('user', [
        {
          functionResponse: {
            name,
            response: responsePayload,
          },
        },
      ]);
    }
  });

  return {
    systemInstruction: systemParts.join('\n\n').trim(),
    contents: output,
  };
};

const createGoogleStreamResponse = (
  stream: AsyncIterable<unknown>,
  created: number,
  model: string,
  onDone: () => void
) => {
  const emittedCalls = new Set<string>();
  const makeChunk = (delta: Record<string, unknown>, finishReason: CompletionFinishReason = null) =>
    ({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    }) as unknown;

  const iterable = {
    async *[Symbol.asyncIterator]() {
      let finalReason: CompletionFinishReason = null;
      try {
        for await (const rawChunk of stream) {
          const chunk = rawChunk as any;
          const text = typeof chunk?.text === 'string' ? chunk.text : '';
          if (text) {
            yield makeChunk({ content: text });
          }

          const functionCalls = Array.isArray(chunk?.functionCalls) ? chunk.functionCalls : [];
          functionCalls.forEach((call: any, index: number) => {
            const name = typeof call?.name === 'string' ? call.name : '';
            const argsObj = call?.args && typeof call.args === 'object' ? call.args : {};
            if (!name) return;
            const key = `${name}::${JSON.stringify(argsObj)}`;
            if (emittedCalls.has(key)) return;
            emittedCalls.add(key);
            const id = getNanoid();
            const delta = {
              tool_calls: [
                {
                  index,
                  id,
                  type: 'function',
                  function: {
                    name,
                    arguments: JSON.stringify(argsObj),
                  },
                },
              ],
            };
            // eslint-disable-next-line no-void
            void (delta && 0);
          });
          for (const [index, call] of functionCalls.entries()) {
            const name = typeof call?.name === 'string' ? call.name : '';
            const argsObj = call?.args && typeof call.args === 'object' ? call.args : {};
            if (!name) continue;
            const key = `${name}::${JSON.stringify(argsObj)}`;
            if (!emittedCalls.has(key)) continue;
            yield makeChunk({
              tool_calls: [
                {
                  index,
                  id: getNanoid(),
                  type: 'function',
                  function: {
                    name,
                    arguments: JSON.stringify(argsObj),
                  },
                },
              ],
            });
            emittedCalls.delete(key);
          }

          const reason =
            chunk?.candidates?.[0]?.finishReason ??
            chunk?.finishReason ??
            chunk?.candidates?.[0]?.finish_reason;
          const mapped = toGoogleFinishReason(reason);
          if (mapped) finalReason = mapped;
        }
        yield makeChunk({}, finalReason || 'stop');
      } finally {
        onDone();
      }
    },
  } as AsyncIterable<unknown> & { controller?: AbortController };

  return iterable;
};

const createGoogleChatCompletion = async ({
  modelData,
  body,
  timeout,
  options,
}: {
  modelData: LLMModelItemType;
  body: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming;
  timeout?: number;
  options?: OpenAI.RequestOptions;
}) => {
  const apiKey = String((modelData as { key?: unknown }).key || '').trim();
  const rawBaseUrl = String((modelData as { baseUrl?: unknown }).baseUrl || '').trim();
  if (!apiKey) {
    throw new Error('Google 协议模型缺少 key 配置');
  }

  const formatTimeout = timeout ? timeout : 600000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), formatTimeout);
  let keepTimerForStream = false;

  const headers = sanitizeHeaders((options?.headers || {}) as Record<string, string>) as Record<
    string,
    string
  >;
  const requestMeta = {
    baseUrl: rawBaseUrl || 'https://generativelanguage.googleapis.com',
    path: '/v1beta/models/*:generateContent',
    headers,
  };

  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      ...(rawBaseUrl ? { baseUrl: rawBaseUrl } : {}),
      headers: (options?.headers || {}) as Record<string, string>,
      timeout: formatTimeout,
    } as any,
  } as any);

  const converted = toGoogleMessages(Array.isArray(body.messages) ? body.messages : []);
  const googleTools = toGoogleTools(body.tools);
  const requestConfig: Record<string, unknown> = {
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    topP: typeof body.top_p === 'number' ? body.top_p : undefined,
    maxOutputTokens:
      typeof body.max_tokens === 'number' && Number.isFinite(body.max_tokens) && body.max_tokens > 0
        ? Math.floor(body.max_tokens)
        : undefined,
    stopSequences: Array.isArray(body.stop)
      ? body.stop
      : typeof body.stop === 'string'
      ? [body.stop]
      : undefined,
    ...(converted.systemInstruction ? { systemInstruction: converted.systemInstruction } : {}),
    ...(googleTools
      ? {
          tools: googleTools,
          toolConfig: toGoogleToolConfig((body as { tool_choice?: unknown }).tool_choice, true),
        }
      : {}),
  };

  const params = {
    model: String(body.model || modelData.model),
    contents: converted.contents,
    config: Object.fromEntries(
      Object.entries(requestConfig).filter(([, value]) => value !== undefined && value !== null)
    ),
  };

  try {
    if (body.stream) {
      const stream = (await (client.models as any).generateContentStream(params)) as AsyncIterable<unknown> & {
        [key: string]: unknown;
      };
      keepTimerForStream = true;
      const streamResponse = createGoogleStreamResponse(
        stream,
        Math.floor(Date.now() / 1000),
        String(body.model || modelData.model),
        () => clearTimeout(timer)
      ) as StreamChatType;
      streamResponse.controller = controller;
      return {
        response: streamResponse,
        isStreamResponse: true as const,
        requestMeta,
      };
    }

    const json = (await (client.models as any).generateContent(params)) as any;
    const text = typeof json?.text === 'string' ? json.text : '';
    const functionCalls = Array.isArray(json?.functionCalls) ? json.functionCalls : [];
    const toolCalls = functionCalls
      .map((call: any) => {
        const name = typeof call?.name === 'string' ? call.name : '';
        if (!name) return null;
        return {
          id: getNanoid(),
          type: 'function',
          function: {
            name,
            arguments: JSON.stringify(
              call?.args && typeof call.args === 'object' ? call.args : {}
            ),
          },
        };
      })
      .filter(Boolean);

    const usageMeta = json?.usageMetadata || {};
    const completion = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: String(body.model || modelData.model),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: text,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: toGoogleFinishReason(
            json?.candidates?.[0]?.finishReason || json?.finishReason
          ),
        },
      ],
      usage: {
        prompt_tokens: Number(usageMeta?.promptTokenCount || 0),
        completion_tokens: Number(usageMeta?.candidatesTokenCount || 0),
        total_tokens:
          Number(usageMeta?.totalTokenCount || 0) ||
          Number(usageMeta?.promptTokenCount || 0) +
            Number(usageMeta?.candidatesTokenCount || 0),
      },
    } as unknown as UnStreamChatType;

    return {
      response: completion,
      isStreamResponse: false as const,
      requestMeta,
    };
  } finally {
    if (!keepTimerForStream) {
      clearTimeout(timer);
    }
  }
};

export const createChatCompletion = async ({
  modelData,
  body,
  userKey,
  timeout,
  options
}: {
  modelData: LLMModelItemType;
  body: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming;
  userKey?: OpenaiAccountType;
  timeout?: number;
  options?: OpenAI.RequestOptions;
}): Promise<
  | {
      response: StreamChatType;
      isStreamResponse: true;
      requestMeta: {
        baseUrl?: string;
        path?: string;
        headers?: Record<string, string>;
      };
    }
  | {
      response: UnStreamChatType;
      isStreamResponse: false;
      requestMeta: {
        baseUrl?: string;
        path?: string;
        headers?: Record<string, string>;
      };
    }
> => {
  const protocol = resolveModelProtocol(modelData);
  let ai: ReturnType<typeof getAIApi> | undefined;
  try {
    if (!modelData) {
      return Promise.reject(`${body.model} not found`);
    }
    body.model = modelData.model;
    addLog.info('[LLM Request][Protocol]', {
      model: body.model,
      protocol
    });

    if (protocol === 'anthropic') {
      return createAnthropicChatCompletion({
        modelData,
        body,
        timeout,
        options,
      });
    }
    if (protocol === 'google') {
      return createGoogleChatCompletion({
        modelData,
        body,
        timeout,
        options,
      });
    }

    const formatTimeout = timeout ? timeout : 600000;
    ai = getAIApi({
      userKey,
      timeout: formatTimeout
    });

    addLog.info(`Start create chat completion`, {
      model: body.model
    });
    const toolNames = body.tools
      ?.map((tool) => tool.function?.name)
      .filter((name): name is string => !!name);
    const messageToolCallNames = body.messages
      ?.flatMap((message) => (message.role === 'assistant' ? message.tool_calls || [] : []))
      .map((call) => call.function?.name)
      .filter((name): name is string => !!name);
    if ((toolNames && toolNames.length) || (messageToolCallNames && messageToolCallNames.length)) {
      addLog.info(`[LLM Request][ToolNames]`, {
        tools: toolNames,
        toolCalls: messageToolCallNames
      });
    }

    const requestHeaders = {
      ...options?.headers,
      ...(modelData.requestAuth ? { Authorization: `Bearer ${modelData.requestAuth}` } : {})
    };
    const requestMeta = {
      baseUrl: (ai as any)?.baseURL || (ai as any)?.baseUrl,
      path: modelData.requestUrl,
      headers: sanitizeHeaders(requestHeaders) as Record<string, string>
    };

    const safeBody = {
      ...body,
      messages: Array.isArray(body.messages)
        ? sanitizeToolResultMessagesForProvider(body.messages)
        : body.messages
    };

    const response = await ai.chat.completions.create(safeBody as any, {
      ...options,
      ...(modelData.requestUrl ? { path: modelData.requestUrl } : {}),
      headers: {
        ...requestHeaders
      }
    });

    const isStreamResponse =
      typeof response === 'object' &&
      response !== null &&
      ('iterator' in response || 'controller' in response);

    if (isStreamResponse) {
      return {
        response,
        isStreamResponse: true,
        requestMeta
      };
    }

    return {
      response,
      isStreamResponse: false,
      requestMeta
    };
  } catch (error) {
    const requestBodyLog = (() => {
      try {
        return JSON.parse(JSON.stringify(body));
      } catch {
        return body;
      }
    })();
    const responseInfo = extractErrorResponseInfo(error);
    if (userKey?.baseUrl) {
      addLog.warn(`User ai api error`, {
        message: getErrText(error),
        request: {
          baseUrl: userKey?.baseUrl,
          path: modelData?.requestUrl,
          headers: sanitizeHeaders({
            ...options?.headers,
            ...(modelData?.requestAuth ? { Authorization: `Bearer ${modelData.requestAuth}` } : {})
          }) as Record<string, string>,
          body
        },
        response: responseInfo
      });
      return Promise.reject(`您的 OpenAI key 出错了: ${getErrText(error)}`);
    } else {
      addLog.info(`[LLM Request][Body]`, {
        body: requestBodyLog
      });
      addLog.error(`LLM response error`, {
        message: getErrText(error),
        request: {
          baseUrl: (ai as any)?.baseURL || (ai as any)?.baseUrl,
          path: modelData?.requestUrl,
          headers: sanitizeHeaders({
            ...options?.headers,
            ...(modelData?.requestAuth ? { Authorization: `Bearer ${modelData.requestAuth}` } : {})
          }) as Record<string, string>
        },
        response: responseInfo
      });
    }
    return Promise.reject(error);
  }
};
