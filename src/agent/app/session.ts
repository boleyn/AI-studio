export type ToolCallRecord = {
  name: string;
  durationMs: number;
  isError: boolean;
};

/**
 * Hermes 会话与轨迹统计（对应 Hermes session / trajectory）。
 */
export class AgentSessionTracker {
  readonly startedAt = Date.now();
  iterations = 0;
  compactions = 0;
  inputTokens = 0;
  outputTokens = 0;
  readonly toolCalls: ToolCallRecord[] = [];

  recordUsage(inputTokens: number, outputTokens: number) {
    this.inputTokens = Math.max(this.inputTokens, inputTokens);
    this.outputTokens += outputTokens;
  }

  recordToolCall(name: string, durationMs: number, isError: boolean) {
    this.toolCalls.push({ name, durationMs, isError });
  }

  toSummary() {
    return {
      durationMs: Date.now() - this.startedAt,
      iterations: this.iterations,
      compactions: this.compactions,
      toolCallsCount: this.toolCalls.length,
      failedToolsCount: this.toolCalls.filter((t) => t.isError).length,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    };
  }
}
