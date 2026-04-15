import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from '@aistudio/ai/compat/global/core/ai/type';
import type { ChatNodeUsageType } from '@aistudio/ai/compat/global/support/wallet/bill/type';
import type {
  ToolCallChildrenInteractive,
  WorkflowInteractiveResponseType,
} from '@aistudio/ai/compat/global/core/workflow/template/system/interactive/type';

export type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded';

export type ToolHandlerResult = {
  response: string;
  assistantMessages: ChatCompletionMessageParam[];
  usages: ChatNodeUsageType[];
  interactive?: WorkflowInteractiveResponseType;
  stop?: boolean;
  isError?: boolean;
};

export type TrackedTool = {
  call: ChatCompletionMessageToolCall;
  status: ToolStatus;
  isConcurrencySafe: boolean;
  result?: ToolHandlerResult;
  promise?: Promise<void>;
};

export type ExecutionState = {
  requestMessages: ChatCompletionMessageParam[];
  assistantMessages: ChatCompletionMessageParam[];
  subAppUsages: ChatNodeUsageType[];
};

export type StreamingToolExecutorHandlers = {
  isAborted?: () => boolean | undefined;
  handleToolResponse: (e: {
    call: ChatCompletionMessageToolCall;
    messages: ChatCompletionMessageParam[];
  }) => Promise<ToolHandlerResult>;
};

export type StreamingToolExecutorResult = {
  shouldStop: boolean;
  interactiveResponse?: ToolCallChildrenInteractive;
};

export type MessageUpdate = {
  message?: ChatCompletionMessageParam;
};
