import {
  registerPendingConversationInteraction,
  clearPendingConversationInteraction,
} from "@server/chat/activeRuns";
import type { InteractionTransport } from "../app/agentLoop";
import type { InteractionDecision } from "../tools/types";

/** Adapt the web conversation's pending approvals to the transport-free core. */
export const createWebInteractionTransport =
  (token: string, chatId: string): InteractionTransport =>
  ({ kind, toolName, toolUseId, input, signal }) =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (decision: InteractionDecision | null) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        clearPendingConversationInteraction({
          token,
          chatId,
          requestId: toolUseId,
        });
        resolve(decision);
      };
      const onAbort = () => finish(null);
      if (signal?.aborted) return finish(null);
      signal?.addEventListener("abort", onAbort, { once: true });
      const registered = registerPendingConversationInteraction({
        token,
        chatId,
        requestId: toolUseId,
        interaction: { kind, toolName, toolUseId, input },
        resolve: finish,
      });
      if (!registered) finish(null);
    });
