import type { ChatCompletionMessageToolCall } from '@aistudio/ai/compat/global/core/ai/type';

const TOOL_LOOP_SIGNATURE_WINDOW = 6;
const OBSERVATION_ONLY_TURN_LIMIT = 4;
const OBSERVATION_TOOLS = new Set(['read', 'grep', 'compile_project']);
const MUTATION_TOOLS = new Set(['write', 'edit']);

export const normalizeToolArgsForFingerprint = (raw: string | undefined) => {
  const value = (raw || '').trim();
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value.replace(/\s+/g, ' ');
  }
};

export const buildToolRoundSignature = (calls: ChatCompletionMessageToolCall[]) => {
  if (!Array.isArray(calls) || calls.length === 0) return '';
  return calls
    .filter((call) => call?.function?.name)
    .map((call) => {
      const name = call.function.name.trim().toLowerCase();
      const args = normalizeToolArgsForFingerprint(call.function.arguments);
      return `${name}::${args}`;
    })
    .join('||');
};

const detectToolCallLoop = (history: string[], current: string) => {
  if (!current) return { shouldStop: false as const, reason: undefined as string | undefined };
  const next = [...history, current].slice(-TOOL_LOOP_SIGNATURE_WINDOW);
  const last3 = next.slice(-3);
  if (last3.length === 3 && last3[0] === last3[1] && last3[1] === last3[2]) {
    return { shouldStop: true as const, reason: 'same_signature_x3' };
  }
  const last4 = next.slice(-4);
  if (
    last4.length === 4 &&
    last4[0] === last4[2] &&
    last4[1] === last4[3] &&
    last4[0] !== last4[1]
  ) {
    return { shouldStop: true as const, reason: 'alternating_abab' };
  }
  return { shouldStop: false as const, reason: undefined as string | undefined };
};

const isObservationOnlyTool = (name: string) => OBSERVATION_TOOLS.has(name);

const isMutatingToolCall = (name: string, argsRaw?: string) => {
  if (MUTATION_TOOLS.has(name)) return true;
  if (name !== 'global' || !argsRaw) return false;
  try {
    const parsed = JSON.parse(argsRaw) as { action?: unknown };
    const action = typeof parsed.action === 'string' ? parsed.action.trim().toLowerCase() : '';
    return action === 'write' || action === 'replace';
  } catch {
    return false;
  }
};

export type ToolLoopGuardState = {
  recentToolRoundSignatures: string[];
  consecutiveObservationOnlyTurns: number;
};

export const createInitialToolLoopGuardState = (): ToolLoopGuardState => ({
  recentToolRoundSignatures: [],
  consecutiveObservationOnlyTurns: 0,
});

export const evaluateToolLoop = (
  calls: ChatCompletionMessageToolCall[],
  state: ToolLoopGuardState
): {
  shouldStop: boolean;
  reason?: string;
  nextState: ToolLoopGuardState;
} => {
  const signature = buildToolRoundSignature(calls);
  const loopCheck = detectToolCallLoop(state.recentToolRoundSignatures, signature);
  const nextSignatures = signature
    ? [...state.recentToolRoundSignatures, signature].slice(-TOOL_LOOP_SIGNATURE_WINDOW)
    : state.recentToolRoundSignatures;
  return {
    shouldStop: loopCheck.shouldStop,
    reason: loopCheck.reason,
    nextState: {
      ...state,
      recentToolRoundSignatures: nextSignatures,
    },
  };
};

export const updateObservationOnlyTurns = (
  calls: ChatCompletionMessageToolCall[],
  state: ToolLoopGuardState
): {
  shouldStop: boolean;
  turns: number;
  nextState: ToolLoopGuardState;
} => {
  if (!Array.isArray(calls) || calls.length === 0) {
    return {
      shouldStop: false,
      turns: state.consecutiveObservationOnlyTurns,
      nextState: state,
    };
  }

  let hasMutatingToolCall = false;
  let allObservationOnly = true;

  for (const tool of calls) {
    const toolName = String(tool?.function?.name || '').trim().toLowerCase();
    if (!isObservationOnlyTool(toolName)) {
      allObservationOnly = false;
    }
    if (isMutatingToolCall(toolName, tool?.function?.arguments)) {
      hasMutatingToolCall = true;
    }
  }

  let turns = state.consecutiveObservationOnlyTurns;
  if (hasMutatingToolCall) {
    turns = 0;
  } else if (allObservationOnly) {
    turns += 1;
  } else {
    turns = 0;
  }

  return {
    shouldStop: turns >= OBSERVATION_ONLY_TURN_LIMIT,
    turns,
    nextState: {
      ...state,
      consecutiveObservationOnlyTurns: turns,
    },
  };
};
