import {
  runAgentSession,
  type AgentSessionInput,
  type AgentSessionResult,
} from "./session";

export type GatewayRunInput = AgentSessionInput;

/** Next.js entry point; session orchestration owns resource lifetime. */
export async function runAgentGateway(
  input: GatewayRunInput,
): Promise<AgentSessionResult> {
  input.onEvent("status", { phase: "runtime_selected", strategy: "hermes" });
  return runAgentSession(input);
}

export type { AgentSessionInput, AgentSessionResult };
