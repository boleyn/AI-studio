// @ts-nocheck
// @ts-nocheck
interface ActiveRunEntry {
  controller: AbortController;
  createdAt: number;
  pendingInteractions?: Map<string, {
    kind: "permission" | "plan_question" | "plan_approval";
    toolName?: string;
    toolUseId?: string;
    input?: unknown;
    createdAt: number;
  }>;
  resolvers?: Map<string, (decision: {
    decision: "approve" | "reject";
    answers?: Record<string, string>;
    note?: string;
    updatedInput?: unknown;
  }) => void>;
}

const activeRuns = new Map<string, ActiveRunEntry>();

const getRunKey = (token: string, chatId: string) => `${token}:${chatId}`;

export const registerActiveConversationRun = ({
  token,
  chatId,
  controller,
}: {
  token: string;
  chatId: string;
  controller: AbortController;
}) => {
  const key = getRunKey(token, chatId);
  const previous = activeRuns.get(key);
  if (previous && previous.controller !== controller && !previous.controller.signal.aborted) {
    previous.controller.abort(new Error("superseded"));
  }
  activeRuns.set(key, {
    controller,
    createdAt: Date.now(),
    pendingInteractions: new Map(),
    resolvers: new Map(),
  });
};

export const unregisterActiveConversationRun = ({
  token,
  chatId,
  controller,
}: {
  token: string;
  chatId: string;
  controller?: AbortController;
}) => {
  const key = getRunKey(token, chatId);
  const current = activeRuns.get(key);
  if (!current) return;
  if (controller && current.controller !== controller) return;
  activeRuns.delete(key);
};

export const stopActiveConversationRun = ({
  token,
  chatId,
}: {
  token: string;
  chatId: string;
}) => {
  const current = activeRuns.get(getRunKey(token, chatId));
  if (!current) return false;
  if (!current.controller.signal.aborted) {
    current.controller.abort(new Error("stop"));
  }
  return true;
};

export const registerPendingConversationInteraction = ({
  token,
  chatId,
  requestId,
  interaction,
  resolve,
}: {
  token: string;
  chatId: string;
  requestId: string;
  interaction: {
    kind: "permission" | "plan_question" | "plan_approval";
    toolName?: string;
    toolUseId?: string;
    input?: unknown;
  };
  resolve?: (decision: {
    decision: "approve" | "reject";
    answers?: Record<string, string>;
    note?: string;
    updatedInput?: unknown;
  }) => void;
}) => {
  const current = activeRuns.get(getRunKey(token, chatId));
  if (!current) return false;
  if (!current.pendingInteractions) {
    current.pendingInteractions = new Map();
  }
  current.pendingInteractions.set(requestId, {
    ...interaction,
    createdAt: Date.now(),
  });
  if (resolve) {
    if (!current.resolvers) {
      current.resolvers = new Map();
    }
    current.resolvers.set(requestId, resolve);
  }
  return true;
};

export const clearPendingConversationInteraction = ({
  token,
  chatId,
  requestId,
}: {
  token: string;
  chatId: string;
  requestId: string;
}) => {
  const current = activeRuns.get(getRunKey(token, chatId));
  if (!current?.pendingInteractions) return false;
  const deleted = current.pendingInteractions.delete(requestId);
  current.resolvers?.delete(requestId);
  return deleted;
};

export const getPendingConversationInteractions = ({
  token,
  chatId,
}: {
  token: string;
  chatId: string;
}) => {
  const current = activeRuns.get(getRunKey(token, chatId));
  if (!current?.pendingInteractions) return [];
  return Array.from(current.pendingInteractions.entries()).map(([requestId, interaction]) => ({
    requestId,
    ...interaction,
  }));
};

export const resolvePendingConversationInteraction = ({
  token,
  chatId,
  requestId,
  decision,
}: {
  token: string;
  chatId: string;
  requestId: string;
  decision: {
    decision: "approve" | "reject";
    answers?: Record<string, string>;
    note?: string;
    updatedInput?: unknown;
  };
}) => {
  const current = activeRuns.get(getRunKey(token, chatId));
  const resolver = current?.resolvers?.get(requestId);
  if (!current || !resolver) return false;
  current.pendingInteractions?.delete(requestId);
  current.resolvers?.delete(requestId);
  resolver(decision);
  return true;
};
