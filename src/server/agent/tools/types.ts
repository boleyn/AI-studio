export type AgentToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (input: unknown) => Promise<unknown>;
};

export type ToolRunResult = {
  ok: boolean;
  content: string;
  raw?: unknown;
};
