import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { trimHistoryToBudget } from "./context";

const estimateTokens = (msg: ChatCompletionMessageParam): number => {
  const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content || "");
  return Math.ceil(content.length / 3.5) + 12;
};

const totalTokens = (messages: ChatCompletionMessageParam[]): number =>
  messages.reduce((sum, m) => sum + estimateTokens(m), 0);

/**
 * 第一阶段（零成本）：对较早轮次的超长 tool 输出做头尾裁剪，保留近期 N 条完整输出。
 */
const pruneOldToolOutputs = (
  messages: ChatCompletionMessageParam[],
  keepRecentCount = 6,
): ChatCompletionMessageParam[] => {
  const cutoff = Math.max(0, messages.length - keepRecentCount);
  return messages.map((msg, idx) => {
    if (idx >= cutoff || msg.role !== "tool" || typeof msg.content !== "string") return msg;
    if (msg.content.length <= 600) return msg;
    const head = msg.content.slice(0, 220);
    const tail = msg.content.slice(-220);
    return {
      ...msg,
      content: `${head}\n...[pruned ${msg.content.length - 440} chars]...\n${tail}`,
    };
  });
};

/**
 * Hermes 上下文压缩器：
 * 1. 先裁剪早期 tool 输出；
 * 2. 若仍超出阈值（默认 78% 窗口），调用 LLM 对早期对话生成结构化摘要，
 *    失败时自动回退到窗口裁剪（trimHistoryToBudget）。
 */
export async function compressContextIfNeeded(params: {
  client: OpenAI;
  model: string;
  messages: ChatCompletionMessageParam[];
  maxContext: number;
  signal?: AbortSignal;
}): Promise<{ messages: ChatCompletionMessageParam[]; compacted: boolean }> {
  const budget = Math.floor(params.maxContext * 0.78);
  if (totalTokens(params.messages) <= budget || params.messages.length <= 6) {
    return { messages: params.messages, compacted: false };
  }

  const pruned = pruneOldToolOutputs(params.messages);
  if (totalTokens(pruned) <= budget) {
    return { messages: pruned, compacted: true };
  }

  const splitIndex = Math.max(2, pruned.length - 6);
  const older = pruned.slice(0, splitIndex);
  const recent = pruned.slice(splitIndex);

  try {
    const serialized = older
      .map((m) => {
        const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
        return `[${m.role}]: ${text.slice(0, 1200)}`;
      })
      .join("\n");

    const summaryResp = await params.client.chat.completions.create(
      {
        model: params.model,
        temperature: 0.1,
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content:
              "Summarize the earlier conversation concisely for continuing an engineering task. " +
              "Include: 1) User Goal, 2) Files read/modified, 3) Decisions & findings, 4) Remaining next steps.",
          },
          { role: "user", content: serialized },
        ],
      },
      { signal: params.signal },
    );

    const summary = summaryResp.choices?.[0]?.message?.content?.trim();
    if (summary) {
      return {
        messages: [{ role: "system", content: `<context_summary>\n${summary}\n</context_summary>` }, ...recent],
        compacted: true,
      };
    }
  } catch {
    // 摘要失败时安全回退到本地裁剪
  }

  return trimHistoryToBudget(pruned, params.maxContext);
}
