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

const sanitizeToolMessagesByToolCalls = (messages: ChatCompletionMessageParam[]) => {
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
          reason: 'tool_call_id_not_found_in_previous_assistant_tool_calls'
        });
      }
      continue;
    }

    sanitized.push(message);
  }

  return sanitized;
};

const normalizeToolArgsForFingerprint = (raw: string | undefined) => {
  const value = (raw || "").trim();
  if (!value) return "";
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value.replace(/\s+/g, " ");
  }
};

const dedupeToolCallsInRound = (calls: ChatCompletionMessageToolCall[]) => {
  const seen = new Set<string>();
  const output: ChatCompletionMessageToolCall[] = [];
  calls.forEach((call) => {
    if (!call || !call.function?.name) return;
    const key = `${call.function.name.trim().toLowerCase()}::${normalizeToolArgsForFingerprint(
      call.function.arguments
    )}`;
    if (seen.has(key)) {
      console.info(
        "[agent-debug][tool-call-deduped]",
        JSON.stringify({
          toolCallId: call.id,
          toolName: call.function.name,
          argsLength: (call.function.arguments || "").length,
        })
      );
      return;
    }
    seen.add(key);
    output.push(call);
  });
  return output;
};

const TOOL_LOOP_SIGNATURE_WINDOW = 6;

const buildToolRoundSignature = (calls: ChatCompletionMessageToolCall[]) => {
  if (!Array.isArray(calls) || calls.length === 0) return "";
  return calls
    .filter((call) => call?.function?.name)
    .map((call) => {
      const name = call.function.name.trim().toLowerCase();
      const args = normalizeToolArgsForFingerprint(call.function.arguments);
      return `${name}::${args}`;
    })
    .join("||");
};

const detectToolCallLoop = (history: string[], current: string) => {
  if (!current) return { shouldStop: false as const, reason: undefined as string | undefined };
  const next = [...history, current].slice(-TOOL_LOOP_SIGNATURE_WINDOW);
  const last3 = next.slice(-3);
  if (last3.length === 3 && last3[0] === last3[1] && last3[1] === last3[2]) {
    return { shouldStop: true as const, reason: "same_signature_x3" };
  }
  const last4 = next.slice(-4);
  if (
    last4.length === 4 &&
    last4[0] === last4[2] &&
    last4[1] === last4[3] &&
    last4[0] !== last4[1]
  ) {
    return { shouldStop: true as const, reason: "alternating_abab" };
  }
  return { shouldStop: false as const, reason: undefined as string | undefined };
};

const OBSERVATION_ONLY_TURN_LIMIT = 4;
const OBSERVATION_TOOLS = new Set(["read", "grep", "compile_project"]);
const MUTATION_TOOLS = new Set(["write", "edit"]);

const isObservationOnlyTool = (name: string) => OBSERVATION_TOOLS.has(name);

const isMutatingToolCall = (name: string, argsRaw?: string) => {
  if (MUTATION_TOOLS.has(name)) return true;
  if (name !== "global" || !argsRaw) return false;
  try {
    const parsed = JSON.parse(argsRaw) as { action?: unknown };
    const action = typeof parsed.action === "string" ? parsed.action.trim().toLowerCase() : "";
    return action === "write" || action === "replace";
  } catch {
    return false;
  }
};

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
  }>;
} & ResponseEvents;

type RunAgentResponse = {
  error?: any;
  completeMessages: ChatCompletionMessageParam[]; // Step request complete messages
  assistantMessages: ChatCompletionMessageParam[]; // Step assistant response messages
  interactiveResponse?: ToolCallChildrenInteractive;

  // Usage
  inputTokens: number;
  outputTokens: number;
  subAppUsages: ChatNodeUsageType[];

  finish_reason: CompletionFinishReason | undefined;
};

/* 
  一个循环进行工具调用的 LLM 请求封装。

  AssistantMessages 组成：
  1. 调用 AI 时生成的 messages
  2. tool 内部调用产生的 messages
  3. tool 响应的值，role=tool，content=tool response

  RequestMessages 为模型请求的消息，组成:
  1. 历史对话记录
  2. 调用 AI 时生成的 messages
  3. tool 响应的值，role=tool，content=tool response

  memoryRequestMessages 为上一轮中断时，requestMessages 的内容
*/
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
    (modelDefaultToolChoiceMode === "auto" || modelDefaultToolChoiceMode === "required"
      ? modelDefaultToolChoiceMode
      : "auto");
  const requestedMaxTokens = max_tokens ?? undefined;

  let runTimes = 0;
  let interactiveResponse: ToolCallChildrenInteractive | undefined;

  // Init messages
  const maxTokens = computedMaxToken({
    model: modelData,
    maxToken: requestedMaxTokens,
    min: 100
  });

  // 本轮产生的 assistantMessages，包括 tool 内产生的
  const assistantMessages: ChatCompletionMessageParam[] = [];
  // 多轮运行时候的请求 messages
  const initialMaxContext = modelData.maxContext - maxTokens;
  const beforeFilterCount = messages.length;
  const beforeFilterTokens = await countGptMessagesTokens(messages).catch(() => -1);
  let requestMessages = await filterGPTMessageByMaxContext({
    messages,
    maxContext: initialMaxContext // filter token. not response maxToken
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

  let inputTokens: number = 0;
  let outputTokens: number = 0;
  let finish_reason: CompletionFinishReason | undefined;
  let requestError: any;
  const subAppUsages: ChatNodeUsageType[] = [];
  const isKimiModel = /kimi/i.test(String(model || ""));
  const isMiniMaxModel = /minimax/i.test(String(model || ""));
  const hasRunLimit = Number.isFinite(maxRunAgentTimes) && (maxRunAgentTimes as number) > 0;
  const runLimit = hasRunLimit ? (maxRunAgentTimes as number) : Infinity;
  let recentToolRoundSignatures: string[] = [];
  let consecutiveObservationOnlyTurns = 0;

  // 处理 tool 里的交互
  if (childrenInteractiveParams) {
    const {
      response,
      assistantMessages: toolAssistantMessages,
      usages,
      interactive,
      stop
    } = await handleInteractiveTool(childrenInteractiveParams);

    // 将 requestMessages 复原成上一轮中断时的内容，并附上 tool response
    requestMessages = childrenInteractiveParams.toolParams.memoryRequestMessages.map((item) =>
      item.role === 'tool' && item.tool_call_id === childrenInteractiveParams.toolParams.toolCallId
        ? {
            ...item,
            content: response
          }
        : item
    );

    // 只需要推送本轮产生的 assistantMessages
    assistantMessages.push(...filterEmptyAssistantMessages(toolAssistantMessages));
    subAppUsages.push(...usages);

    // 相同 tool 触发了多次交互, 调用的 toolId 认为是相同的
    if (interactive) {
      // console.dir(interactive, { depth: null });
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

    // 正常完成该工具的响应，继续进行工具调用
  }

  // 自循环运行
  while (runTimes < runLimit) {
    if (isAborted?.()) {
      finish_reason = 'stop';
      break;
    }
    // TODO: 费用检测

    runTimes++;

    // 1. Compress request messages
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
    requestMessages = result.messages;
    requestMessages = sanitizeToolMessagesByToolCalls(requestMessages);
    inputTokens += result.usage?.inputTokens || 0;
    outputTokens += result.usage?.outputTokens || 0;

    // 2. Request LLM
    let {
      reasoningText: reasoningContent,
      answerText: answer,
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
        // Kimi often emits duplicate batched tool calls; run sequential tool planning for stability.
        // MiniMax also shows instability on large multi-file write_file payloads.
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
      break;
    }
    if (responseEmptyTip) {
      return Promise.reject(responseEmptyTip);
    }

    // 3. 更新 messages
    const cloneRequestMessages = requestMessages.slice();
    // 推送 AI 生成后的 assistantMessages
    assistantMessages.push(...llmAssistantMessage);
    requestMessages.push(...llmAssistantMessage);

    // 4. Call tools
    toolCalls = dedupeToolCallsInRound(toolCalls);
    let toolCallStep = false;
    const toolRoundSignature = buildToolRoundSignature(toolCalls);
    const loopCheck = detectToolCallLoop(recentToolRoundSignatures, toolRoundSignature);
    if (toolRoundSignature) {
      recentToolRoundSignatures = [...recentToolRoundSignatures, toolRoundSignature].slice(
        -TOOL_LOOP_SIGNATURE_WINDOW
      );
    }
    if (loopCheck.shouldStop) {
      toolCallStep = true;
      finish_reason = "stop";
      const loopNotice =
        `检测到可能的工具调用循环（${loopCheck.reason}），已停止自动工具调用。` +
        "请调整提示词、降低 tool_choice 约束或限制可用工具后重试。";
      const loopMessage: ChatCompletionMessageParam = {
        role: ChatCompletionRequestMessageRoleEnum.Assistant,
        content: loopNotice
      };
      assistantMessages.push(loopMessage);
      requestMessages.push(loopMessage);
      addLog.warn("[LLM ToolLoop][stop-loop]", {
        runTimes,
        reason: loopCheck.reason || "",
        signature: toolRoundSignature
      });
    }

    if (!toolCallStep) {
      let hasMutatingToolCall = false;
      let hasToolCall = false;
      let allObservationOnly = true;
      for await (const tool of toolCalls) {
        if (!tool) {
          console.warn(
            "[agent-debug][tool-exec-skip-empty-call]",
            JSON.stringify({ runTimes })
          );
          continue;
        }
        console.info(
          "[agent-debug][tool-exec-start]",
          JSON.stringify({
            runTimes,
            toolCallId: tool.id,
            toolName: tool.function?.name,
            aborted: Boolean(isAborted?.())
          })
        );

        if (isAborted?.()) {
          toolCallStep = true;
          finish_reason = 'stop';
          console.info(
            "[agent-debug][tool-exec-skip-aborted]",
            JSON.stringify({
              runTimes,
              toolCallId: tool.id,
              toolName: tool.function?.name
            })
          );
          break;
        }
        const {
          response,
          assistantMessages: toolAssistantMessages,
          usages,
          interactive,
          stop
        } = await handleToolResponse({
          call: tool,
          messages: cloneRequestMessages
        });
        const toolName = String(tool.function?.name || "").trim().toLowerCase();
        hasToolCall = true;
        if (!isObservationOnlyTool(toolName)) {
          allObservationOnly = false;
        }
        if (isMutatingToolCall(toolName, tool.function?.arguments)) {
          hasMutatingToolCall = true;
        }

        const toolMessage: ChatCompletionMessageParam = {
          tool_call_id: tool.id,
          role: ChatCompletionRequestMessageRoleEnum.Tool,
          content: response
        };
        console.info(
          "[agent-debug][tool-exec-finish]",
          JSON.stringify({
            runTimes,
            toolCallId: tool.id,
            toolName: tool.function?.name,
            responseLength: typeof response === 'string' ? response.length : 0,
            stop: Boolean(stop),
            interactive: Boolean(interactive)
          })
        );

        // 5. Add tool response to messages
        assistantMessages.push(toolMessage);
        assistantMessages.push(...filterEmptyAssistantMessages(toolAssistantMessages)); // 因为 toolAssistantMessages 也需要记录成 AI 响应，所以这里需要推送。
        requestMessages.push(toolMessage); // 请求的 Request 只需要工具响应，不需要工具中 assistant 的内容，所以不推送 toolAssistantMessages

        subAppUsages.push(...usages);

        if (interactive) {
          interactiveResponse = {
            type: 'toolChildrenInteractive',
            params: {
              childrenResponse: interactive,
              toolParams: {
                memoryRequestMessages: [],
                toolCallId: tool.id
              }
            }
          } as any;
        }
        if (stop) {
          toolCallStep = true;
          if (isAborted?.()) {
            finish_reason = 'stop';
          }
        }
      }

      if (hasToolCall) {
        if (hasMutatingToolCall) {
          consecutiveObservationOnlyTurns = 0;
        } else if (allObservationOnly) {
          consecutiveObservationOnlyTurns += 1;
        } else {
          consecutiveObservationOnlyTurns = 0;
        }
      }

      if (consecutiveObservationOnlyTurns >= OBSERVATION_ONLY_TURN_LIMIT) {
        toolCallStep = true;
        finish_reason = "stop";
        const noProgressNotice =
          `检测到连续 ${consecutiveObservationOnlyTurns} 轮仅执行观察类工具（Read/Grep/compile_project）且无写入动作，已停止自动重试。` +
          "请明确给出一次性修改指令，或放宽工具策略后再继续。";
        const noProgressMessage: ChatCompletionMessageParam = {
          role: ChatCompletionRequestMessageRoleEnum.Assistant,
          content: noProgressNotice
        };
        assistantMessages.push(noProgressMessage);
        requestMessages.push(noProgressMessage);
        addLog.warn("[LLM ToolLoop][stop-observation-only]", {
          runTimes,
          consecutiveObservationOnlyTurns
        });
      }
    }

    // 6 Record usage
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;

    if (toolCalls.length === 0 || !!interactiveResponse || toolCallStep) {
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
    finish_reason = "stop";
    const limitNotice =
      `已达到最大自动执行轮次（${runLimit}），为避免无效循环已停止。` +
      "如需继续，请明确下一步目标或提高 AI_RECURSION_LIMIT 后重试。";
    const limitMessage: ChatCompletionMessageParam = {
      role: ChatCompletionRequestMessageRoleEnum.Assistant,
      content: limitNotice
    };
    assistantMessages.push(limitMessage);
    requestMessages.push(limitMessage);
    addLog.warn("[LLM ToolLoop][stop-recursion-limit]", {
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
