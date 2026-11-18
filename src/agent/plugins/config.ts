import type { PluginPolicy } from "./types";

/** Operator-owned policy, never arbitrary executable module paths from a chat request. */
export function loadPluginPolicy(env = process.env): PluginPolicy {
  const raw = env.AGENT_PLUGINS?.trim();
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("AGENT_PLUGINS must be an object");
  const policy = value as Record<string, unknown>;
  for (const key of Object.keys(policy)) {
    if (key !== "enabled" && key !== "disabled")
      throw new Error(`Unknown AGENT_PLUGINS option: ${key}`);
    if (
      !Array.isArray(policy[key]) ||
      !(policy[key] as unknown[]).every(
        (id) => typeof id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(id),
      )
    ) {
      throw new Error(`AGENT_PLUGINS.${key} must contain plugin IDs`);
    }
  }
  return policy as PluginPolicy;
}
