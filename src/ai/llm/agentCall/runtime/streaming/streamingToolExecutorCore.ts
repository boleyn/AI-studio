import type { ChatCompletionMessageToolCall } from '@aistudio/ai/compat/global/core/ai/type';
import { ChatCompletionRequestMessageRoleEnum } from '@aistudio/ai/compat/global/core/ai/constants';
import { filterEmptyAssistantMessages } from '../../utils';
import { isToolConcurrencySafe } from '../toolConcurrency';
import { createSyntheticErrorResult, type SyntheticReason } from './errorResult';
import { canExecuteTool, getExecutingPromises, hasUnfinishedTools } from './scheduler';
import type {
  ExecutionState,
  MessageUpdate,
  StreamingToolExecutorHandlers,
  StreamingToolExecutorResult,
  ToolHandlerResult,
  TrackedTool,
} from './types';

export class StreamingToolExecutorCore {
  private readonly tools: TrackedTool[];
  private hasErrored = false;
  private erroredToolDescription = '';
  private discarded = false;
  private shouldStop = false;
  private interactiveResponse: StreamingToolExecutorResult['interactiveResponse'];

  constructor(
    calls: ChatCompletionMessageToolCall[],
    private readonly state: ExecutionState,
    private readonly handlers: StreamingToolExecutorHandlers,
    private readonly runTimes: number
  ) {
    this.tools = calls.map((call) => ({
      call,
      status: 'queued',
      isConcurrencySafe: isToolConcurrencySafe(call),
    }));
  }

  discard() {
    this.discarded = true;
  }

  *getCompletedResults(): Generator<MessageUpdate, void> {
    for (const tool of this.tools) {
      if (tool.status !== 'completed' || !tool.result) continue;
      const call = tool.call;
      const result = tool.result;
      const toolMessage = {
        tool_call_id: call.id,
        role: ChatCompletionRequestMessageRoleEnum.Tool,
        content: result.response,
      } as const;

      this.state.assistantMessages.push(toolMessage);
      this.state.assistantMessages.push(...filterEmptyAssistantMessages(result.assistantMessages));
      this.state.requestMessages.push(toolMessage);
      this.state.subAppUsages.push(...result.usages);

      tool.status = 'yielded';
      yield { message: toolMessage };
    }
  }

  async *getRemainingResults(): AsyncGenerator<MessageUpdate, void> {
    while (!this.shouldStop && hasUnfinishedTools(this.tools)) {
      this.startRunnableTools();

      for (const item of this.getCompletedResults()) {
        yield item;
      }

      if (this.shouldStop || this.interactiveResponse) break;

      const executingPromises = getExecutingPromises(this.tools);
      if (executingPromises.length === 0) break;
      await Promise.race(executingPromises);

      for (const item of this.getCompletedResults()) {
        yield item;
      }
    }

    for (const item of this.getCompletedResults()) {
      yield item;
    }
  }

  async run(): Promise<StreamingToolExecutorResult> {
    for await (const _ of this.getRemainingResults()) {
      void _;
    }

    return {
      shouldStop: this.shouldStop,
      interactiveResponse: this.interactiveResponse,
    };
  }

  getState(): StreamingToolExecutorResult {
    return {
      shouldStop: this.shouldStop,
      interactiveResponse: this.interactiveResponse,
    };
  }

  private startRunnableTools() {
    for (const tool of this.tools) {
      if (tool.status !== 'queued') continue;
      if (this.shouldStop || this.interactiveResponse) break;

      if (!canExecuteTool(this.tools, tool)) {
        if (!tool.isConcurrencySafe) break;
        continue;
      }

      this.startTool(tool);
      if (!tool.isConcurrencySafe) break;
    }
  }

  private startTool(tool: TrackedTool) {
    const call = tool.call;
    tool.status = 'executing';

    const abortReason = this.getAbortReason(tool);
    if (abortReason) {
      tool.status = 'completed';
      tool.result = createSyntheticErrorResult(abortReason, true, {
        erroredToolDescription: this.erroredToolDescription,
      });
      if (abortReason === 'user_interrupted') this.shouldStop = true;
      return;
    }

    if (this.handlers.isAborted?.()) {
      this.shouldStop = true;
      tool.status = 'completed';
      tool.result = createSyntheticErrorResult('user_interrupted', true);
      return;
    }

    console.info(
      '[agent-debug][tool-exec-start]',
      JSON.stringify({
        runTimes: this.runTimes,
        toolCallId: call.id,
        toolName: call.function?.name,
        aborted: Boolean(this.handlers.isAborted?.()),
        concurrencySafe: tool.isConcurrencySafe,
      })
    );

    const job = (async () => {
      const result = await this.handlers.handleToolResponse({
        call,
        messages: this.state.requestMessages.slice(),
      });

      tool.result = result;
      tool.status = 'completed';

      console.info(
        '[agent-debug][tool-exec-finish]',
        JSON.stringify({
          runTimes: this.runTimes,
          toolCallId: call.id,
          toolName: call.function?.name,
          responseLength: typeof result.response === 'string' ? result.response.length : 0,
          stop: Boolean(result.stop),
          interactive: Boolean(result.interactive),
          concurrencySafe: tool.isConcurrencySafe,
        })
      );

      this.applyResultSideEffects(call, result);
    })().catch((error) => {
      tool.status = 'completed';
      tool.result = createSyntheticErrorResult('execution_error', true, {
        message: String(error instanceof Error ? error.message : error),
      });
      this.shouldStop = true;
    });

    tool.promise = job;
  }

  private applyResultSideEffects(call: ChatCompletionMessageToolCall, result: ToolHandlerResult) {
    if (result.interactive && !this.interactiveResponse) {
      this.interactiveResponse = {
        type: 'toolChildrenInteractive',
        params: {
          childrenResponse: result.interactive,
          toolParams: {
            memoryRequestMessages: [],
            toolCallId: call.id,
          },
        },
      } as any;
    }

    if (result.stop) {
      this.shouldStop = true;
    }

    if (result.isError && this.isBashLikeTool(call)) {
      this.hasErrored = true;
      this.erroredToolDescription = this.describeTool(call);
    }
  }

  private getAbortReason(tool: TrackedTool): SyntheticReason | null {
    if (this.discarded) return 'streaming_fallback';
    if (this.hasErrored && !this.isBashLikeTool(tool.call)) return 'sibling_error';
    if (this.handlers.isAborted?.()) return 'user_interrupted';
    return null;
  }

  private isBashLikeTool(call: ChatCompletionMessageToolCall) {
    const name = String(call?.function?.name || '').trim().toLowerCase();
    return name === 'bash';
  }

  private describeTool(call: ChatCompletionMessageToolCall) {
    const name = String(call?.function?.name || 'tool').trim();
    const args = String(call?.function?.arguments || '').trim();
    const summary = args.length > 40 ? `${args.slice(0, 40)}...` : args;
    return summary ? `${name}(${summary})` : name;
  }
}
