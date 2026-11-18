import { encode } from "gpt-tokenizer";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

/** Tokenizer estimate, not a provider guarantee. Count the full serialized request
 * (including tool arguments/schema) and keep explicit framing/output headroom. */
export const estimateTokens = (value: unknown) => encode(typeof value === "string" ? value : JSON.stringify(value)).length;
export function requestTokens(system: string, tools: ChatCompletionTool[], messages: ChatCompletionMessageParam[]) {
  return estimateTokens({ messages: [{ role: "system", content: system }, ...messages], tools }) + messages.length * 12 + 128;
}

/** Tool calls and all corresponding results are indivisible. Fail closed on
 * malformed transcripts instead of silently sending orphaned results. */
export function conversationGroups(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[][] {
  const groups: ChatCompletionMessageParam[][] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === "tool") throw new Error("context_orphan_tool_result");
    const group: ChatCompletionMessageParam[] = [message];
    if (message.role === "assistant" && message.tool_calls?.length) {
      const pending = new Set(message.tool_calls.map((call) => call.id));
      if (pending.size !== message.tool_calls.length) throw new Error("context_duplicate_tool_call");
      while (pending.size) {
        const result = messages[++i];
        if (!result || result.role !== "tool" || !pending.delete(result.tool_call_id)) throw new Error("context_incomplete_tool_round");
        group.push(result);
      }
    }
    groups.push(group);
  }
  return groups;
}

export function contextLimits(maxContext: number) {
  if (!Number.isFinite(maxContext) || maxContext < 1024) throw new Error("invalid_model_context_limit");
  const output = Math.min(8192, Math.floor(maxContext * 0.15));
  const headroom = Math.max(256, Math.floor(maxContext * 0.05));
  const input = Math.floor(maxContext - output - headroom);
  return { output, input, target: Math.floor(input * 0.7) };
}
