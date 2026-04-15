import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from '@aistudio/ai/compat/global/core/ai/type';
import type { ChatNodeUsageType } from '@aistudio/ai/compat/global/support/wallet/bill/type';
import type {
  ToolCallChildrenInteractive,
  WorkflowInteractiveResponseType,
} from '@aistudio/ai/compat/global/core/workflow/template/system/interactive/type';
import { StreamingToolExecutor } from './streamingToolExecutor';

type ToolExecutionHandlers = {
  isAborted?: () => boolean | undefined;
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
};

type ToolExecutionState = {
  requestMessages: ChatCompletionMessageParam[];
  assistantMessages: ChatCompletionMessageParam[];
  subAppUsages: ChatNodeUsageType[];
};

export type ExecuteToolCallsResult = {
  stop: boolean;
  interactiveResponse?: ToolCallChildrenInteractive;
};

export const createToolExecutor = (
  toolCalls: ChatCompletionMessageToolCall[],
  state: ToolExecutionState,
  handlers: ToolExecutionHandlers,
  runTimes: number
): StreamingToolExecutor => new StreamingToolExecutor(toolCalls, state, handlers, runTimes);

export const executeToolCallsSequentially = async (
  toolCalls: ChatCompletionMessageToolCall[],
  state: ToolExecutionState,
  handlers: ToolExecutionHandlers,
  runTimes: number
): Promise<ExecuteToolCallsResult> => {
  const executor = createToolExecutor(toolCalls, state, handlers, runTimes);
  const result = await executor.run();
  return {
    stop: result.shouldStop,
    interactiveResponse: result.interactiveResponse,
  };
};
