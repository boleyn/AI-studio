import type { TrackedTool } from './types';

export const hasUnfinishedTools = (tools: TrackedTool[]) =>
  tools.some((tool) => tool.status !== 'yielded');

export const canExecuteTool = (tools: TrackedTool[], tool: TrackedTool) => {
  const executing = tools.filter((item) => item.status === 'executing');
  if (executing.length === 0) return true;
  if (!tool.isConcurrencySafe) return false;
  return executing.every((item) => item.isConcurrencySafe);
};

export const getExecutingPromises = (tools: TrackedTool[]) =>
  tools
    .filter((tool) => tool.status === 'executing' && tool.promise)
    .map((tool) => tool.promise as Promise<void>);
