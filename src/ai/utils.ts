import { type LLMModelItemType } from '@aistudio/ai/compat/global/core/ai/model.d';
import type { CompletionFinishReason, CompletionUsage } from '@aistudio/ai/compat/global/core/ai/type';
import { getLLMDefaultUsage } from '@aistudio/ai/compat/global/core/ai/constants';
import { removeDatasetCiteText } from '@aistudio/ai/compat/global/core/ai/llm/utils';
import json5 from 'json5';
import { sliceJsonStr } from '@aistudio/ai/compat/global/common/string/tools';

/* 
  Count response max token
  When maxToken is undefined, use a reasonable default value to balance response length and context space.
  Default: min(2000, maxResponse / 2) to ensure sufficient context for history messages.
*/
export const computedMaxToken = ({
  maxToken,
  model,
  min
}: {
  maxToken?: number;
  model: LLMModelItemType;
  min?: number;
}) => {
  // 规范化 model.maxResponse：如果无效则根据 maxContext 动态计算
  // 修复某些模型配置中 maxResponse 为空字符串或 undefined 的问题
  const normalizedMaxResponse = (() => {
    const raw = model.maxResponse;
    // 检查是否为有效的正数
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return raw;
    }

    // 无效值：根据 maxContext 动态计算合理的输出上限
    // 策略：为输出预留 25% 的上下文空间，最小 2000，最大 16000
    const contextBasedDefault = Math.floor(model.maxContext * 0.25);
    return Math.max(2000, Math.min(contextBasedDefault, 16000));
  })();

  // 参数校验
  if (maxToken !== undefined && maxToken !== null) {
    // 检查是否为有效数字
    if (!Number.isFinite(maxToken)) {
      throw new Error(`max_tokens must be a finite number, got: ${maxToken}`);
    }
    // 检查是否为正数
    if (maxToken <= 0) {
      throw new Error(
        `max_tokens must be greater than 0, got: ${maxToken}. Use undefined to apply default value.`
      );
    }
    // 检查是否超过模型上限（使用规范化后的值）
    if (maxToken > normalizedMaxResponse) {
      throw new Error(
        `max_tokens (${maxToken}) exceeds model maximum response limit (${normalizedMaxResponse}). Please reduce max_tokens or use a model with higher limits.`
      );
    }
  }

  // 计算最终的 maxToken
  // 优先级：AI配置的 maxToken > 模型默认值 > 动态计算的最小值
  const targetMaxToken = (() => {
    // 1. 如果 AI 配置中指定了 maxToken，直接使用（已经过校验）
    if (maxToken !== undefined && maxToken !== null) {
      return maxToken;
    }

    // 2. 如果没有指定，使用智能默认值
    // 针对大任务场景（写作、代码生成、长文本处理）优化
    // 策略：根据模型上下文大小，动态调整输出占比
    const ctx = model.maxContext;

    // 大上下文模型（>= 100k）：激进策略，给输出预留更多空间
    // 例如 Gemini 1.5 (300k), Claude 3 (200k) - 使用 70% 的 maxResponse，最小 8000
    if (ctx >= 100000) {
      return Math.max(8000, Math.floor(normalizedMaxResponse * 0.7));
    }

    // 中等上下文模型（32k-100k）：平衡策略
    // 例如 GPT-4-32k - 使用 60% 的 maxResponse，最小 4000
    if (ctx >= 32000) {
      return Math.max(4000, Math.floor(normalizedMaxResponse * 0.6));
    }

    // 小上下文模型（< 32k）：保守策略，优先保证历史空间
    // 例如 GPT-3.5, GPT-4 - 使用 50% 的 maxResponse，最小 2000
    return Math.max(2000, Math.floor(normalizedMaxResponse * 0.5));
  })();

  // 确保不超过模型上限
  const limited = Math.min(targetMaxToken, normalizedMaxResponse);
  // 确保满足最小值要求
  return Math.max(limited, min || 1);
};

// FastGPT temperature range: [0,10], ai temperature:[0,2],{0,1]……
export const computedTemperature = ({
  model,
  temperature
}: {
  model: LLMModelItemType;
  temperature: number;
}) => {
  if (typeof model.maxTemperature !== 'number') return undefined;
  temperature = +(model.maxTemperature * (temperature / 10)).toFixed(2);
  temperature = Math.max(temperature, 0.01);

  return temperature;
};

// LLM utils
// Parse <think></think> tags to think and answer - unstream response
export const parseReasoningContent = (text: string): [string, string] => {
  const regex = /<think>([\s\S]*?)<\/think>/;
  const match = text.match(regex);

  if (!match) {
    return ['', text];
  }

  const thinkContent = match[1].trim();

  // Add answer (remaining text after think tag)
  const answerContent = text.slice(match.index! + match[0].length);

  return [thinkContent, answerContent];
};

// Parse llm stream part
export const parseLLMStreamResponse = () => {
  let isInThinkTag: boolean | undefined = undefined;
  let startTagBuffer = '';
  let endTagBuffer = '';

  const thinkStartChars = '<think>';
  const thinkEndChars = '</think>';

  let citeBuffer = '';
  const maxCiteBufferLength = 32; // [Object](CITE)总长度为32

  // Buffer
  let buffer_finishReason: CompletionFinishReason = null;
  let buffer_usage: CompletionUsage = getLLMDefaultUsage();
  let buffer_reasoningContent = '';
  let buffer_content = '';
  let error: any = undefined;

  /* 
    parseThinkTag - 只控制是否主动解析 <think></think>，如果接口已经解析了，则不再解析。
    retainDatasetCite - 
  */
  const parsePart = ({
    part,
    parseThinkTag = true,
    retainDatasetCite = true
  }: {
    part: {
      error?: any;
      choices: {
        delta: {
          content?: string | null;
          reasoning_content?: string;
        };
        finish_reason?: CompletionFinishReason;
      }[];
      usage?: CompletionUsage | null;
    };
    parseThinkTag?: boolean;
    retainDatasetCite?: boolean;
  }): {
    error?: any;
    reasoningContent: string;
    content: string; // 原始内容，不去掉 cite
    responseContent: string; // 响应的内容，会去掉 cite
    finishReason: CompletionFinishReason;
  } => {
    const data = (() => {
      buffer_usage = part.usage || buffer_usage;

      const finishReason = part.choices?.[0]?.finish_reason || null;
      buffer_finishReason = finishReason || buffer_finishReason;

      const content = part.choices?.[0]?.delta?.content || '';
      // @ts-ignore
      const reasoningContent =
        part.choices?.[0]?.delta?.reasoning_content ||
        (part.choices?.[0]?.delta as any)?.reasoning ||
        '';
      const isStreamEnd = !!buffer_finishReason;

      // Parse think
      const { reasoningContent: parsedThinkReasoningContent, content: parsedThinkContent } =
        (() => {
          if (reasoningContent || !parseThinkTag) {
            isInThinkTag = false;
            return { reasoningContent, content };
          }

          // 如果不在 think 标签中，或者有 reasoningContent(接口已解析），则返回 reasoningContent 和 content
          if (isInThinkTag === false) {
            return {
              reasoningContent: '',
              content
            };
          }

          // 检测是否为 think 标签开头的数据
          if (isInThinkTag === undefined) {
            // Parse content think and answer
            startTagBuffer += content;
            // 太少内容时候，暂时不解析
            if (startTagBuffer.length < thinkStartChars.length) {
              if (isStreamEnd) {
                const tmpContent = startTagBuffer;
                startTagBuffer = '';
                return {
                  reasoningContent: '',
                  content: tmpContent
                };
              }
              return {
                reasoningContent: '',
                content: ''
              };
            }

            if (startTagBuffer.startsWith(thinkStartChars)) {
              isInThinkTag = true;
              return {
                reasoningContent: startTagBuffer.slice(thinkStartChars.length),
                content: ''
              };
            }

            // 如果未命中 think 标签，则认为不在 think 标签中，返回 buffer 内容作为 content
            isInThinkTag = false;
            return {
              reasoningContent: '',
              content: startTagBuffer
            };
          }

          // 确认是 think 标签内容，开始返回 think 内容，并实时检测 </think>
          /* 
        检测 </think> 方案。
        存储所有疑似 </think> 的内容，直到检测到完整的 </think> 标签或超出 </think> 长度。
        content 返回值包含以下几种情况:
          abc - 完全未命中尾标签
          abc<th - 命中一部分尾标签
          abc</think> - 完全命中尾标签
          abc</think>abc - 完全命中尾标签
          </think>abc - 完全命中尾标签
          k>abc - 命中一部分尾标签
      */
          // endTagBuffer 专门用来记录疑似尾标签的内容
          if (endTagBuffer) {
            endTagBuffer += content;
            if (endTagBuffer.includes(thinkEndChars)) {
              isInThinkTag = false;
              const answer = endTagBuffer.slice(thinkEndChars.length);
              return {
                reasoningContent: '',
                content: answer
              };
            } else if (endTagBuffer.length >= thinkEndChars.length) {
              // 缓存内容超出尾标签长度，且仍未命中 </think>，则认为本次猜测 </think> 失败，仍处于 think 阶段。
              const tmp = endTagBuffer;
              endTagBuffer = '';
              return {
                reasoningContent: tmp,
                content: ''
              };
            }
            return {
              reasoningContent: '',
              content: ''
            };
          } else if (content.includes(thinkEndChars)) {
            // 返回内容，完整命中</think>，直接结束
            isInThinkTag = false;
            const [think, answer] = content.split(thinkEndChars);
            return {
              reasoningContent: think,
              content: answer
            };
          } else {
            // 无 buffer，且未命中 </think>，开始疑似 </think> 检测。
            for (let i = 1; i < thinkEndChars.length; i++) {
              const partialEndTag = thinkEndChars.slice(0, i);
              // 命中一部分尾标签
              if (content.endsWith(partialEndTag)) {
                const think = content.slice(0, -partialEndTag.length);
                endTagBuffer += partialEndTag;
                return {
                  reasoningContent: think,
                  content: ''
                };
              }
            }
          }

          // 完全未命中尾标签，还是 think 阶段。
          return {
            reasoningContent: content,
            content: ''
          };
        })();

      // Parse datset cite
      if (retainDatasetCite) {
        return {
          reasoningContent: parsedThinkReasoningContent,
          content: parsedThinkContent,
          responseContent: parsedThinkContent,
          finishReason: buffer_finishReason
        };
      }

      // 缓存包含 [ 的字符串，直到超出 maxCiteBufferLength 再一次性返回
      const parseCite = (text: string) => {
        // 结束时，返回所有剩余内容
        if (isStreamEnd) {
          const content = citeBuffer + text;
          citeBuffer = ''; // 清空缓冲区，避免重复输出
          return {
            content: removeDatasetCiteText(content, false)
          };
        }

        // 新内容包含 [，初始化缓冲数据
        if (text.includes('[') || text.includes('【')) {
          const index = text.indexOf('[') !== -1 ? text.indexOf('[') : text.indexOf('【');
          const beforeContent = citeBuffer + text.slice(0, index);
          citeBuffer = text.slice(index);

          // beforeContent 可能是：普通字符串，带 [ 的字符串
          return {
            content: removeDatasetCiteText(beforeContent, false)
          };
        }
        // 处于 Cite 缓冲区，判断是否满足条件
        else if (citeBuffer) {
          citeBuffer += text;

          // 检查缓冲区长度是否达到完整Quote长度或已经流结束
          if (citeBuffer.length >= maxCiteBufferLength) {
            const content = removeDatasetCiteText(citeBuffer, false);
            citeBuffer = '';

            return {
              content
            };
          } else {
            // 暂时不返回内容
            return { content: '' };
          }
        }

        return {
          content: text
        };
      };
      const { content: pasedCiteContent } = parseCite(parsedThinkContent);

      return {
        reasoningContent: parsedThinkReasoningContent,
        content: parsedThinkContent,
        responseContent: pasedCiteContent,
        finishReason: buffer_finishReason
      };
    })();

    buffer_reasoningContent += data.reasoningContent;
    buffer_content += data.content;

    error = part.error || error;

    return data;
  };

  const getResponseData = () => {
    return {
      error,
      finish_reason: buffer_finishReason,
      usage: buffer_usage,
      reasoningContent: buffer_reasoningContent,
      content: buffer_content
    };
  };

  const updateFinishReason = (finishReason: CompletionFinishReason) => {
    buffer_finishReason = finishReason;
  };
  const updateError = (err: any) => {
    error = err;
  };

  return {
    parsePart,
    getResponseData,
    updateFinishReason,
    updateError
  };
};

// Re-export to match aichat agentCall import shape
export { filterGPTMessageByMaxContext } from './llm/utils';

// Re-export for backward compatibility
export { llmCompletionsBodyFormat } from './llm/request';

export const parseToolArgs = <T = Record<string, any>>(toolArgs: string) => {
  try {
    return json5.parse(sliceJsonStr(toolArgs)) as T;
  } catch {
    return;
  }
};
