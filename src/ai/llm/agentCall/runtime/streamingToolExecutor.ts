import type { ChatCompletionMessageToolCall } from '@aistudio/ai/compat/global/core/ai/type';
import { StreamingToolExecutorCore } from './streaming/streamingToolExecutorCore';
import type {
  ExecutionState,
  StreamingToolExecutorHandlers,
  StreamingToolExecutorResult,
} from './streaming/types';

export class StreamingToolExecutor {
  private readonly core: StreamingToolExecutorCore;

  constructor(
    calls: ChatCompletionMessageToolCall[],
    state: ExecutionState,
    handlers: StreamingToolExecutorHandlers,
    runTimes: number
  ) {
    this.core = new StreamingToolExecutorCore(calls, state, handlers, runTimes);
  }

  discard() {
    this.core.discard();
  }

  getCompletedResults() {
    return this.core.getCompletedResults();
  }

  getRemainingResults() {
    return this.core.getRemainingResults();
  }

  run(): Promise<StreamingToolExecutorResult> {
    return this.core.run();
  }

  getState(): StreamingToolExecutorResult {
    return this.core.getState();
  }
}

export type {
  ExecutionState,
  MessageUpdate,
  StreamingToolExecutorHandlers,
  StreamingToolExecutorResult,
  ToolHandlerResult,
} from './streaming/types';
