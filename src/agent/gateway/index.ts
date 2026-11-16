import { runHermesAgent, type RunHermesAgentInput, type RunHermesAgentResult } from "../app";
import type { SandboxKind } from "../sandbox";

export type RuntimeStrategy = "hermes" | "query_engine";

export const resolveRuntimeStrategy = (requested?: unknown): RuntimeStrategy => {
  const normalized = typeof requested === "string" ? requested.trim().toLowerCase() : "";
  if (normalized === "query_engine") return "query_engine";
  return "hermes";
};

export type GatewayRunInput = Omit<RunHermesAgentInput, "sandboxKind"> & {
  runtimeStrategy?: RuntimeStrategy;
  sandboxKind?: SandboxKind;
};

/**
 * Hermes Gateway 入口：接收 Next.js / SSE 层的请求并调度 Agent 主体。
 */
export async function runAgentGateway(input: GatewayRunInput): Promise<RunHermesAgentResult> {
  input.onEvent("status", {
    phase: "runtime_selected",
    strategy: input.runtimeStrategy || "hermes",
  });
  return runHermesAgent(input);
}

export { runHermesAgent, type RunHermesAgentInput, type RunHermesAgentResult };
