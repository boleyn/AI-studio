import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
  CompletionFinishReason
} from '@aistudio/ai/compat/global/core/ai/type';
import { ChatCompletionRequestMessageRoleEnum } from '@aistudio/ai/compat/global/core/ai/constants';
import type {
  ToolCallChildrenInteractive,
  WorkflowInteractiveResponseType
} from '@aistudio/ai/compat/global/core/workflow/template/system/interactive/type';
import type { CreateLLMResponseProps, ResponseEvents } from '../request';
import { createLLMResponse } from '../request';
import type { ChatNodeUsageType } from '@aistudio/ai/compat/global/support/wallet/bill/type';
import { compressRequestMessages } from '../compress';
import { computedMaxToken } from '@aistudio/ai/utils';
import { filterGPTMessageByMaxContext } from '@aistudio/ai/utils';
import { getLLMModel, getModelToolChoiceMode } from '@aistudio/ai/model';
import { filterEmptyAssistantMessages } from './utils';
import { countGptMessagesTokens } from '@aistudio/ai/compat/common/string/tiktoken/index';
import { addLog } from '@aistudio/ai/compat/common/system/log';
import { dedupeToolCallsInRound } from './runtime/toolCallNormalizer';
import {
  createInitialToolLoopGuardState,
  evaluateToolLoop,
  updateObservationOnlyTurns,
  type ToolLoopGuardState,
} from './runtime/toolLoopGuard';
import { createToolExecutor } from './runtime/toolExecutor';
import {
  collectMissingToolResults,
  createSyntheticToolResultMessage,
} from './runtime/toolResultCompensation';
import { sanitizeToolMessagesByToolCalls } from './runtime/toolMessageSanitizer';
import { logToolIntentWithoutStructuredCall } from './runtime/toolIntentDiagnostics';

type RunAgentCallProps = {
  maxRunAgentTimes?: number;
  compressTaskDescription?: string;

  body: CreateLLMResponseProps['body'] & {
    tools: ChatCompletionTool[];

    temperature?: number;
    top_p?: number;
    stream?: boolean;
  };

  userKey?: CreateLLMResponseProps['userKey'];
  isAborted?: CreateLLMResponseProps['isAborted'];

  childrenInteractiveParams?: ToolCallChildrenInteractive['params'];
  handleInteractiveTool: (e: ToolCallChildrenInteractive['params']) => Promise<{
    response: string;
    assistantMessages: ChatCompletionMessageParam[];
    usages: ChatNodeUsageType[];
    interactive?: WorkflowInteractiveResponseType;
    stop?: boolean;
  }>;

  handleToolResponse: (e: {
    call: ChatCompletionMessageToolCall;
    messages: ChatCompletionMessageParam[];
  }) => Promise<{
    response: string;
    assistantMessages: ChatCompletionMessageParam[];
    usages: ChatNodeUsageType[];
    interactive?: WorkflowInteractiveResponseType;
    stop?: boolean;
    isError?: boolean;
  }>;
} & ResponseEvents;

type RunAgentResponse = {
  error?: any;
  completeMessages: ChatCompletionMessageParam[];
  assistantMessages: ChatCompletionMessageParam[];
  interactiveResponse?: ToolCallChildrenInteractive;
  inputTokens: number;
  outputTokens: number;
  subAppUsages: ChatNodeUsageType[];
  finish_reason: CompletionFinishReason | undefined;
};

const appendLoopStopMessage = (
  requestMessages: ChatCompletionMessageParam[],
  assistantMessages: ChatCompletionMessageParam[],
  reason: string
) => {
  const loopNotice =
    `检测到可能的工具调用循环（${reason}），已停止自动工具调用。` +
    '请调整提示词、降低 tool_choice 约束或限制可用工具后重试。';
  const loopMessage: ChatCompletionMessageParam = {
    role: ChatCompletionRequestMessageRoleEnum.Assistant,
    content: loopNotice
  };
  assistantMessages.push(loopMessage);
  requestMessages.push(loopMessage);
};

const appendObservationStopMessage = (
  requestMessages: ChatCompletionMessageParam[],
  assistantMessages: ChatCompletionMessageParam[],
  turns: number
) => {
  const noProgressNotice =
    `检测到连续 ${turns} 轮仅执行观察类工具（Read/Grep/compile_project）且无写入动作，已停止自动重试。` +
    '请明确给出一次性修改指令，或放宽工具策略后再继续。';
  const noProgressMessage: ChatCompletionMessageParam = {
    role: ChatCompletionRequestMessageRoleEnum.Assistant,
    content: noProgressNotice
  };
  assistantMessages.push(noProgressMessage);
  requestMessages.push(noProgressMessage);
};

const appendRecursionLimitMessage = (
  requestMessages: ChatCompletionMessageParam[],
  assistantMessages: ChatCompletionMessageParam[],
  runLimit: number
) => {
  const limitNotice =
    `已达到最大自动执行轮次（${runLimit}），为避免无效循环已停止。` +
    '如需继续，请明确下一步目标或提高 AI_RECURSION_LIMIT 后重试。';
  const limitMessage: ChatCompletionMessageParam = {
    role: ChatCompletionRequestMessageRoleEnum.Assistant,
    content: limitNotice
  };
  assistantMessages.push(limitMessage);
  requestMessages.push(limitMessage);
};

const applyMissingToolResultCompensation = (
  requestMessages: ChatCompletionMessageParam[],
  assistantMessages: ChatCompletionMessageParam[],
  reason: string
) => {
  const missing = collectMissingToolResults(requestMessages);
  if (missing.length === 0) return;

  missing.forEach((item) => {
    const synthetic = createSyntheticToolResultMessage(
      item.toolCallId,
      `${reason}: ${item.toolName}`
    );
    requestMessages.push(synthetic);
    assistantMessages.push(synthetic);
  });

  addLog.warn('[LLM ToolCall][missing-tool-result-compensated]', {
    count: missing.length,
    reason,
    tool_call_ids: missing.map((item) => item.toolCallId),
  });
};

export const runAgentCall = async ({
  maxRunAgentTimes,
  body: { model, messages, max_tokens, tools, ...body },
  userKey,
  isAborted,
  childrenInteractiveParams,
  handleInteractiveTool,
  handleToolResponse,
  onReasoning,
  onStreaming,
  onToolCall,
  onToolParam
}: RunAgentCallProps): Promise<RunAgentResponse> => {
  const modelData = getLLMModel(String(model));
  const modelDefaultToolChoiceMode = getModelToolChoiceMode(String(model));
  const resolvedToolChoice =
    body.tool_choice ??
    (modelDefaultToolChoiceMode === 'auto' || modelDefaultToolChoiceMode === 'required'
      ? modelDefaultToolChoiceMode
      : 'auto');
  const requestedMaxTokens = max_tokens ?? undefined;

  let runTimes = 0;
  let interactiveResponse: ToolCallChildrenInteractive | undefined;

  const maxTokens = computedMaxToken({
    model: modelData,
    maxToken: requestedMaxTokens,
    min: 100
  });

  const assistantMessages: ChatCompletionMessageParam[] = [];
  const initialMaxContext = modelData.maxContext - maxTokens;
  const beforeFilterCount = messages.length;
  const beforeFilterTokens = await countGptMessagesTokens(messages).catch(() => -1);
  let requestMessages = await filterGPTMessageByMaxContext({
    messages,
    maxContext: initialMaxContext
  });
  const afterFilterCount = requestMessages.length;
  const afterFilterTokens = await countGptMessagesTokens(requestMessages).catch(() => -1);

  console.info(
    '[agent-debug][context-filter]',
    JSON.stringify(
      {
        model: modelData.model,
        modelMaxContext: modelData.maxContext,
        reservedMaxTokens: maxTokens,
        effectiveMaxContext: initialMaxContext,
        beforeFilterCount,
        beforeFilterTokens,
        afterFilterCount,
        afterFilterTokens,
        beforeRoles: messages.map((item) => item.role),
        afterRoles: requestMessages.map((item) => item.role)
      },
      null,
      2
    )
  );

  let inputTokens = 0;
  let outputTokens = 0;
  let finish_reason: CompletionFinishReason | undefined;
  let requestError: any;
  const subAppUsages: ChatNodeUsageType[] = [];
  const isKimiModel = /kimi/i.test(String(model || ''));
  const isMiniMaxModel = /minimax/i.test(String(model || ''));
  const hasRunLimit = Number.isFinite(maxRunAgentTimes) && (maxRunAgentTimes as number) > 0;
  const runLimit = hasRunLimit ? (maxRunAgentTimes as number) : Infinity;
  let loopGuardState: ToolLoopGuardState = createInitialToolLoopGuardState();

  if (childrenInteractiveParams) {
    const {
      response,
      assistantMessages: toolAssistantMessages,
      usages,
      interactive,
      stop
    } = await handleInteractiveTool(childrenInteractiveParams);

    requestMessages = childrenInteractiveParams.toolParams.memoryRequestMessages.map((item) =>
      item.role === 'tool' && item.tool_call_id === childrenInteractiveParams.toolParams.toolCallId
        ? {
            ...item,
            content: response
          }
        : item
    );

    assistantMessages.push(...filterEmptyAssistantMessages(toolAssistantMessages));
    subAppUsages.push(...usages);

    if (interactive) {
      interactiveResponse = {
        type: 'toolChildrenInteractive',
        params: {
          childrenResponse: interactive,
          toolParams: {
            memoryRequestMessages: requestMessages,
            toolCallId: childrenInteractiveParams.toolParams.toolCallId
          }
        }
      } as any;
    }

    if (interactiveResponse || stop) {
      return {
        inputTokens: 0,
        outputTokens: 0,
        subAppUsages,
        completeMessages: requestMessages,
        assistantMessages,
        interactiveResponse,
        finish_reason: 'stop'
      };
    }
  }

  while (runTimes < runLimit) {
    if (isAborted?.()) {
      finish_reason = 'stop';
      break;
    }

    runTimes++;

    const result = await compressRequestMessages({
      messages: requestMessages,
      model: modelData
    });

    if (result.messages.length !== requestMessages.length) {
      console.info(
        '[agent-debug][compression-changed]',
        JSON.stringify(
          {
            runTimes,
            beforeCount: requestMessages.length,
            afterCount: result.messages.length,
            beforeRoles: requestMessages.map((item) => item.role),
            afterRoles: result.messages.map((item) => item.role)
          },
          null,
          2
        )
      );
    }

    requestMessages = sanitizeToolMessagesByToolCalls(result.messages);
    inputTokens += result.usage?.inputTokens || 0;
    outputTokens += result.usage?.outputTokens || 0;

    const {
      toolCalls = [],
      usage,
      responseEmptyTip,
      assistantMessage: llmAssistantMessage,
      finish_reason: finishReason,
      error
    } = await createLLMResponse({
      throwError: false,
      body: {
        ...body,
        model,
        messages: requestMessages,
        tool_choice: resolvedToolChoice,
        toolCallMode: 'toolChoice',
        tools,
        parallel_tool_calls: !isKimiModel && !isMiniMaxModel
      },
      userKey,
      isAborted,
      onReasoning,
      onStreaming,
      onToolCall,
      onToolParam
    });

    finish_reason = finishReason;
    requestError = error;

    if (requestError) {
      applyMissingToolResultCompensation(requestMessages, assistantMessages, 'model_error');
      break;
    }
    if (responseEmptyTip) {
      applyMissingToolResultCompensation(requestMessages, assistantMessages, 'empty_response');
      return Promise.reject(responseEmptyTip);
    }

    assistantMessages.push(...llmAssistantMessage);
    requestMessages.push(...llmAssistantMessage);

    const dedupedToolCalls = dedupeToolCallsInRound(toolCalls);

    if (dedupedToolCalls.length === 0) {
      logToolIntentWithoutStructuredCall({
        model: String(model),
        finishReason: finish_reason,
        assistantMessages: llmAssistantMessage,
      });
    }

    const loopEval = evaluateToolLoop(dedupedToolCalls, loopGuardState);
    loopGuardState = loopEval.nextState;
    if (loopEval.shouldStop) {
      finish_reason = 'stop';
      appendLoopStopMessage(requestMessages, assistantMessages, loopEval.reason || 'loop_detected');
      addLog.warn('[LLM ToolLoop][stop-loop]', {
        runTimes,
        reason: loopEval.reason || ''
      });
      applyMissingToolResultCompensation(requestMessages, assistantMessages, 'loop_guard_stop');
      break;
    }

    if (dedupedToolCalls.length > 0) {
      const toolExecutor = createToolExecutor(
        dedupedToolCalls,
        {
          requestMessages,
          assistantMessages,
          subAppUsages,
        },
        {
          isAborted,
          handleToolResponse,
        },
        runTimes
      );
      // Use a single drain channel to preserve UI event ordering and avoid duplicate tool echoes.
      for await (const _update of toolExecutor.getRemainingResults()) {
        void _update;
      }
      const execResult = toolExecutor.getState();

      if (execResult.interactiveResponse) {
        interactiveResponse = execResult.interactiveResponse;
      }

      const observationEval = updateObservationOnlyTurns(dedupedToolCalls, loopGuardState);
      loopGuardState = observationEval.nextState;
      if (observationEval.shouldStop) {
        finish_reason = 'stop';
        appendObservationStopMessage(requestMessages, assistantMessages, observationEval.turns);
        addLog.warn('[LLM ToolLoop][stop-observation-only]', {
          runTimes,
          consecutiveObservationOnlyTurns: observationEval.turns
        });
        applyMissingToolResultCompensation(requestMessages, assistantMessages, 'observation_guard_stop');
        break;
      }

      if (execResult.shouldStop || interactiveResponse) {
        if (isAborted?.()) finish_reason = 'stop';
        applyMissingToolResultCompensation(requestMessages, assistantMessages, 'tool_execution_stop');
        break;
      }
    }

    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;

    if (dedupedToolCalls.length === 0 || !!interactiveResponse) {
      break;
    }
  }

  if (
    runLimit !== Infinity &&
    runTimes >= runLimit &&
    !interactiveResponse &&
    !requestError &&
    !isAborted?.()
  ) {
    finish_reason = 'stop';
    appendRecursionLimitMessage(requestMessages, assistantMessages, runLimit);
    addLog.warn('[LLM ToolLoop][stop-recursion-limit]', {
      runTimes,
      runLimit
    });
  }

  if (interactiveResponse) {
    interactiveResponse.params.toolParams.memoryRequestMessages = requestMessages;
  }

  return {
    error: requestError,
    inputTokens,
    outputTokens,
    subAppUsages,
    completeMessages: requestMessages,
    assistantMessages,
    interactiveResponse,
    finish_reason
  };
};
