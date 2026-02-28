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
  computedMaxToken,
  computedTemperature,
  parseLLMStreamResponse,
  parseReasoningContent
} from '@aistudio/ai/utils';
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
    const stripDefaultApiPrefix = (name: string) =>
      name.startsWith('default_api:') ? name.slice('default_api:'.length) : name;
    let callingTool: {
      id?: string;
      name: string;
      arguments: string;
    } | null = null;
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

            const hasNewTool = toolCall?.function?.name || callingTool;
            if (hasNewTool) {
              if (toolCall?.function?.name) {
                callingTool = {
                  id: toolCall.id,
                  name: toolCall.function?.name || '',
                  arguments: toolCall.function?.arguments || ''
                };
              } else if (callingTool) {
                callingTool.name += toolCall.function?.name || '';
                callingTool.arguments += toolCall.function?.arguments || '';
              }

              const toolName = callingTool!.name;
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
              if (matchTool) {
                const call: ChatCompletionMessageToolCall = {
                  id: callingTool?.id || getNanoid(),
                  type: 'function',
                  function: {
                    name: toolName || matchTool.function.name,
                    arguments: callingTool!.arguments
                  } as ChatCompletionMessageToolCall['function']
                };
                addLog.info('[LLM ToolCall][stream]', {
                  id: call.id,
                  name: call.function?.name
                });
                toolCalls[index] = call;
                onToolCall?.({ call });
                callingTool = null;
              }
            } else {
              const arg: string = toolCall?.function?.arguments ?? '';
              const currentTool = toolCalls[index];
              if (
                currentTool &&
                arg &&
                currentTool.type === 'function' &&
                'function' in currentTool &&
                currentTool.function
              ) {
                const toolWithFunction = currentTool as ChatCompletionMessageToolCall & {
                  type: 'function';
                  function: { name: string; arguments: string };
                };
                toolWithFunction.function.arguments += arg;

                onToolParam?.({ tool: currentTool, params: arg });
              }
            }
          });
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

  const maxTokens = computedMaxToken({
    model: modelData,
    maxToken: body.max_tokens || undefined
  });

  const formatStop = stop?.split('|').filter((item) => !!item.trim());
  let requestBody = ({
    ...body,
    max_tokens: maxTokens,
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
  let ai: ReturnType<typeof getAIApi> | undefined;
  try {
    if (!modelData) {
      return Promise.reject(`${body.model} not found`);
    }
    body.model = modelData.model;

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

    const response = await ai.chat.completions.create(body, {
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
