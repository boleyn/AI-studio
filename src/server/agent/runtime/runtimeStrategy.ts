export type RuntimeStrategy = "compat" | "query_engine_shadow" | "query_engine";

const normalize = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
};

export const resolveRuntimeStrategy = (requested?: unknown): RuntimeStrategy => {
  const normalized = normalize(requested) || normalize(process.env.AGENT_RUNTIME_STRATEGY);
  if (normalized === "query_engine") return "query_engine";
  if (normalized === "query_engine_shadow") return "query_engine_shadow";
  return "query_engine";
};
