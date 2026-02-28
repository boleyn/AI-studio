interface ActiveRunEntry {
  controller: AbortController;
  createdAt: number;
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
  activeRuns.set(getRunKey(token, chatId), {
    controller,
    createdAt: Date.now(),
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

