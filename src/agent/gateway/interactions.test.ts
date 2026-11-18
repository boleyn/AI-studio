import { expect, test } from "bun:test";
import { createWebInteractionTransport } from "./interactions";
import {
  registerActiveConversationRun,
  unregisterActiveConversationRun,
  getPendingConversationInteractions,
  resolvePendingConversationInteraction,
} from "@server/chat/activeRuns";

test("gateway approval resumes exactly once and cancellation removes pending UI state", async () => {
  const identity = { token: "gateway-fixture", chatId: "test" };
  const controller = new AbortController();
  registerActiveConversationRun({ ...identity, controller });
  try {
    const transport = createWebInteractionTransport(
      identity.token,
      identity.chatId,
    );
    const pending = transport({
      kind: "plan_question",
      toolName: "AskUserQuestion",
      toolUseId: "question",
      input: {},
      signal: controller.signal,
    });
    expect(getPendingConversationInteractions(identity)).toHaveLength(1);
    expect(
      resolvePendingConversationInteraction({
        ...identity,
        requestId: "question",
        decision: { decision: "approve", answers: { answer: "yes" } },
      }),
    ).toBe(true);
    expect((await pending)?.answers).toEqual({ answer: "yes" });
    expect(getPendingConversationInteractions(identity)).toHaveLength(0);
    const cancelled = transport({
      kind: "plan_approval",
      toolName: "ExitPlanMode",
      toolUseId: "plan",
      input: {},
      signal: controller.signal,
    });
    controller.abort();
    expect(await cancelled).toBeNull();
    expect(getPendingConversationInteractions(identity)).toHaveLength(0);
  } finally {
    unregisterActiveConversationRun({ ...identity, controller });
  }
});
