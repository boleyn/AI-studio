import { describe, expect, it } from "bun:test";
import {
  extractSelectionQuotesFromMessage,
  formatSelectionQuotesForPrompt,
  normalizeSelectionQuotes,
} from "./selectionChat";

describe("selectionChat helpers", () => {
  it("normalizes valid selection quotes and filters invalid entries", () => {
    const quotes = normalizeSelectionQuotes([
      { id: "q1", text: "  今天可以收工，肩部的量已经到位  ", messageId: "m1", role: "assistant" },
      { id: "q2", text: "   " },
      null,
      { text: "第二段引用" },
    ]);

    expect(quotes).toEqual([
      {
        id: "q1",
        text: "今天可以收工，肩部的量已经到位",
        messageId: "m1",
        role: "assistant",
      },
      {
        id: "quote-2",
        text: "第二段引用",
      },
    ]);
  });

  it("extracts selection quotes from meta, additional_kwargs, or nested sdkMessage.meta", () => {
    expect(
      extractSelectionQuotesFromMessage({
        meta: { selectionQuotes: [{ id: "a", text: "from meta" }] },
      })
    ).toEqual([{ id: "a", text: "from meta" }]);

    expect(
      extractSelectionQuotesFromMessage({
        additional_kwargs: { selectionQuotes: [{ id: "b", text: "from kwargs" }] },
      })
    ).toEqual([{ id: "b", text: "from kwargs" }]);

    expect(
      extractSelectionQuotesFromMessage({
        additional_kwargs: {
          sdkMessage: {
            meta: { selectionQuotes: [{ id: "c", text: "from sdkMessage" }] },
          },
        },
      })
    ).toEqual([{ id: "c", text: "from sdkMessage" }]);
  });

  it("formats single and multiple selection quotes cleanly for LLM prompts", () => {
    const single = formatSelectionQuotesForPrompt([
      { id: "1", text: "第一行\n第二行" },
    ]);
    expect(single).toContain("[用户引用的对话片段]");
    expect(single).toContain("> 第一行\n> 第二行");

    const multi = formatSelectionQuotesForPrompt([
      { id: "1", text: "片段A" },
      { id: "2", text: "片段B" },
    ]);
    expect(multi).toContain("[引用片段 1]");
    expect(multi).toContain("[引用片段 2]");
  });
});
