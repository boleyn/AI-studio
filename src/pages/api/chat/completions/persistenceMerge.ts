import { extractText } from "@shared/chat/messages";

type AnyRecord = Record<string, unknown>;

const toRecord = (value: unknown): AnyRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};

const toArrayOfRecords = (value: unknown): AnyRecord[] =>
  Array.isArray(value)
    ? value.filter((item): item is AnyRecord => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];

const normalizePayload = (value: unknown) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      return trimmed.replace(/\s+/g, " ");
    }
  }
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const getToolFingerprint = (value: AnyRecord) =>
  `${String(value.toolName || "").trim().toLowerCase()}::${normalizePayload(value.params)}::${normalizePayload(value.response)}`;

const mergeToolDetails = (existing: unknown, incoming: unknown) => {
  const seed = toArrayOfRecords(existing).map((item) => ({ ...item }));
  const nextById = new Map<string, number>();
  const nextByFingerprint = new Map<string, number>();

  seed.forEach((item, index) => {
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (id) nextById.set(id, index);
    nextByFingerprint.set(getToolFingerprint(item), index);
  });

  toArrayOfRecords(incoming).forEach((item) => {
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const fingerprint = getToolFingerprint(item);
    const hit = (id ? nextById.get(id) : undefined) ?? nextByFingerprint.get(fingerprint);
    if (hit == null) {
      const inserted = seed.push({ ...item }) - 1;
      if (id) nextById.set(id, inserted);
      nextByFingerprint.set(fingerprint, inserted);
      return;
    }
    const current = seed[hit];
    seed[hit] = {
      ...current,
      ...item,
      params:
        String(item.params || "").length >= String(current.params || "").length
          ? item.params
          : current.params,
      response:
        String(item.response || "").length >= String(current.response || "").length
          ? item.response
          : current.response,
    };
  });

  return seed;
};

const mergeTimeline = (existing: unknown, incoming: unknown) => {
  const seed = toArrayOfRecords(existing).map((item) => ({ ...item }));
  const incomingList = toArrayOfRecords(incoming);
  if (incomingList.length === 0) return seed;

  const toolIndexById = new Map<string, number>();
  seed.forEach((item, index) => {
    if (item.type !== "tool") return;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (id) toolIndexById.set(id, index);
  });

  incomingList.forEach((item) => {
    if (item.type !== "tool") {
      const last = seed[seed.length - 1];
      if (
        last &&
        last.type === item.type &&
        typeof last.text === "string" &&
        typeof item.text === "string" &&
        last.text.endsWith(item.text)
      ) {
        return;
      }
      seed.push({ ...item });
      return;
    }

    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
      seed.push({ ...item });
      return;
    }
    const hit = toolIndexById.get(id);
    if (hit == null) {
      const inserted = seed.push({ ...item }) - 1;
      toolIndexById.set(id, inserted);
      return;
    }
    const current = seed[hit];
    seed[hit] = {
      ...current,
      ...item,
      params: String(item.params || "").length >= String(current.params || "").length ? item.params : current.params,
      response:
        String(item.response || "").length >= String(current.response || "").length
          ? item.response
          : current.response,
    };
  });

  return seed;
};

const mergeStepResponses = (existing: unknown, incoming: unknown) => {
  const seed = toArrayOfRecords(existing).map((item) => ({ ...item }));
  const keyOf = (item: AnyRecord, index: number) =>
    `${String(item.nodeId || "")}::${String(item.moduleName || "")}::${String(item.runningTime || "")}::${index}`;
  const indexByKey = new Map<string, number>();
  seed.forEach((item, index) => {
    indexByKey.set(keyOf(item, index), index);
  });

  toArrayOfRecords(incoming).forEach((item, index) => {
    const key = keyOf(item, index);
    const hit = indexByKey.get(key);
    if (hit == null) {
      indexByKey.set(key, seed.length);
      seed.push({ ...item });
      return;
    }
    seed[hit] = { ...seed[hit], ...item };
  });

  return seed;
};

const mergeTaskSnapshots = (existing: unknown, incoming: unknown) => {
  const nextById = new Map<string, AnyRecord>();
  const append = (value: unknown) => {
    toArrayOfRecords(value).forEach((item) => {
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id) return;
      nextById.set(id, { ...(nextById.get(id) || {}), ...item });
    });
  };
  append(existing);
  append(incoming);
  return [...nextById.values()];
};

const mergeStringMap = (existing: unknown, incoming: unknown) => {
  const left = toRecord(existing);
  const right = toRecord(incoming);
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...left, ...right })) {
    if (typeof value === "string" && value.trim()) next[key] = value;
  }
  return next;
};

const hasOwn = (obj: AnyRecord, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

export const mergeAssistantAdditionalKwargs = ({
  existing,
  incoming,
}: {
  existing?: unknown;
  incoming?: unknown;
}) => {
  const existingKwargs = toRecord(existing);
  const incomingKwargs = toRecord(incoming);
  const next: AnyRecord = {
    ...existingKwargs,
    ...incomingKwargs,
  };

  next.toolDetails = mergeToolDetails(existingKwargs.toolDetails, incomingKwargs.toolDetails);
  next.timeline = mergeTimeline(existingKwargs.timeline, incomingKwargs.timeline);
  next.responseData = mergeStepResponses(existingKwargs.responseData, incomingKwargs.responseData);
  next.agentTasks = mergeTaskSnapshots(existingKwargs.agentTasks, incomingKwargs.agentTasks);
  next.sessionTasks = mergeTaskSnapshots(existingKwargs.sessionTasks, incomingKwargs.sessionTasks);
  next.planAnswers = mergeStringMap(existingKwargs.planAnswers, incomingKwargs.planAnswers);
  next.planModeInteractionState = {
    ...toRecord(existingKwargs.planModeInteractionState),
    ...toRecord(incomingKwargs.planModeInteractionState),
  };

  if (!hasOwn(incomingKwargs, "planQuestions") && hasOwn(existingKwargs, "planQuestions")) {
    next.planQuestions = existingKwargs.planQuestions;
  }
  if (!hasOwn(incomingKwargs, "planQuestionSubmission") && hasOwn(existingKwargs, "planQuestionSubmission")) {
    next.planQuestionSubmission = existingKwargs.planQuestionSubmission;
  }
  if (!hasOwn(incomingKwargs, "planProgress") && hasOwn(existingKwargs, "planProgress")) {
    next.planProgress = existingKwargs.planProgress;
  }
  if (!hasOwn(incomingKwargs, "planModeApproval") && hasOwn(existingKwargs, "planModeApproval")) {
    next.planModeApproval = existingKwargs.planModeApproval;
  }
  if (
    !hasOwn(incomingKwargs, "planModeApprovalDecision") &&
    hasOwn(existingKwargs, "planModeApprovalDecision")
  ) {
    next.planModeApprovalDecision = existingKwargs.planModeApprovalDecision;
  }
  if (!hasOwn(incomingKwargs, "executionDelegationMode") && hasOwn(existingKwargs, "executionDelegationMode")) {
    next.executionDelegationMode = existingKwargs.executionDelegationMode;
  }

  return next;
};

export const resolveAssistantContentForPersistence = ({
  generatedContent,
  resolvedFinalMessage,
  existingMessage,
}: {
  generatedContent: unknown;
  resolvedFinalMessage: string;
  existingMessage?: { content?: unknown } | null;
}) => {
  const generatedText = extractText(generatedContent).trim();
  if (generatedText) return generatedText;
  const finalText = (resolvedFinalMessage || "").trim();
  if (finalText) return finalText;
  const existingText = extractText(existingMessage?.content).trim();
  return existingText;
};
