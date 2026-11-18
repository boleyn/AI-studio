import type { ToolDefinition } from "../tools/types";

export type PluginManifest = {
  id: string;
  version: string;
  description: string;
  defaultEnabled?: boolean;
  requiresEnv?: string[];
};

/** Plugins are trusted server modules, never executable files from a project snapshot. */
export type AgentPlugin = {
  manifest: PluginManifest;
  setup: (context: PluginContext) => void | Promise<void>;
};

export type PluginContext = {
  registerSkill: (skill: { name: string; content: string; tools?: string[]; resources?: Record<string, string> }) => void;
  registerPrompt: (
    render: (toolNames: ReadonlySet<string>) => string | undefined,
  ) => void;
  registerTool: <Input>(tool: ToolDefinition<Input>) => void;
  onDispose: (dispose: () => void | Promise<void>) => void;
};

export type PluginPolicy = {
  enabled?: string[];
  disabled?: string[];
};
