import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPendingConversationInteraction,
  getPendingConversationInteractions,
  registerActiveConversationRun,
  registerPendingConversationInteraction,
  resolvePendingConversationInteraction,
  unregisterActiveConversationRun,
} from "./activeRuns";

test("activeRuns resolves pending interaction only after explicit resolve", async () => {
  const token = "tok-test";
  const chatId = "chat-test";
  const controller = new AbortController();
  registerActiveConversationRun({ token, chatId, controller });

  let resolvedDecision: { decision: "approve" | "reject"; note?: string } | null = null;
  const registered = registerPendingConversationInteraction({
    token,
    chatId,
    requestId: "req-1",
    interaction: {
      kind: "plan_question",
      toolName: "AskUserQuestion",
      toolUseId: "req-1",
      input: { questions: [{ id: "q1", question: "Pick one" }] },
    },
    resolve: (decision) => {
      resolvedDecision = {
        decision: decision.decision,
        ...(decision.note ? { note: decision.note } : {}),
      };
    },
  });
  assert.equal(registered, true);

  const pendingBefore = getPendingConversationInteractions({ token, chatId });
  assert.equal(pendingBefore.length, 1);
  assert.equal(pendingBefore[0]?.requestId, "req-1");
  assert.equal(resolvedDecision, null);

  const resolved = resolvePendingConversationInteraction({
    token,
    chatId,
    requestId: "req-1",
    decision: { decision: "approve", note: "ok" },
  });
  assert.equal(resolved, true);
  assert.deepEqual(resolvedDecision, { decision: "approve", note: "ok" });

  const pendingAfter = getPendingConversationInteractions({ token, chatId });
  assert.equal(pendingAfter.length, 0);

  unregisterActiveConversationRun({ token, chatId, controller });
});

test("activeRuns does not resolve unknown request and allows explicit clear", () => {
  const token = "tok-test-2";
  const chatId = "chat-test-2";
  const controller = new AbortController();
  registerActiveConversationRun({ token, chatId, controller });

  const registered = registerPendingConversationInteraction({
    token,
    chatId,
    requestId: "req-keep",
    interaction: {
      kind: "plan_approval",
      toolName: "ExitPlanMode",
      toolUseId: "req-keep",
    },
  });
  assert.equal(registered, true);

  const unresolved = resolvePendingConversationInteraction({
    token,
    chatId,
    requestId: "req-missing",
    decision: { decision: "approve" },
  });
  assert.equal(unresolved, false);
  assert.equal(getPendingConversationInteractions({ token, chatId }).length, 1);

  const cleared = clearPendingConversationInteraction({
    token,
    chatId,
    requestId: "req-keep",
  });
  assert.equal(cleared, true);
  assert.equal(getPendingConversationInteractions({ token, chatId }).length, 0);

  unregisterActiveConversationRun({ token, chatId, controller });
});
