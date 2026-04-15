import type { AgentTaskSnapshot } from "../types/chatPanelRuntime";
import type { TimelineItem } from "./chatItemParsers";

export const SUB_AGENT_TOOL_NAMES = new Set([
  "spawn_agent",
  "send_input",
  "send_message",
  "wait_agent",
  "list_agents",
  "get_agent_result",
  "close_agent",
  "resume_agent",
]);

export type SubAgentTimelineEvent = {
  id: string;
  toolName: string;
  params: string;
  response: string;
  taskSnapshots: AgentTaskSnapshot[];
};

const safeJsonParse = (value?: string): unknown => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const mergeTaskSnapshots = (input: unknown): AgentTaskSnapshot[] => {
  const nextById = new Map<string, AgentTaskSnapshot>();
  const append = (item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const task = item as AgentTaskSnapshot;
    if (typeof task.id !== "string" || !task.id.trim()) return;
    nextById.set(task.id, {
      ...(nextById.get(task.id) || {}),
      ...task,
    });
  };

  if (Array.isArray(input)) {
    input.forEach(append);
    return [...nextById.values()];
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }

  const record = input as Record<string, unknown>;
  if (Array.isArray(record.agents)) {
    record.agents.forEach(append);
  } else if (record.agent && typeof record.agent === "object" && !Array.isArray(record.agent)) {
    append(record.agent);
  } else {
    append(record);
  }

  return [...nextById.values()];
};

export const buildSubAgentTimelineEvents = (timelineItems: TimelineItem[]): SubAgentTimelineEvent[] => {
  const next: SubAgentTimelineEvent[] = [];

  timelineItems.forEach((item, index) => {
    if (item.type !== "tool") return;
    const normalizedToolName = (item.toolName || "").trim().toLowerCase();
    if (!SUB_AGENT_TOOL_NAMES.has(normalizedToolName)) return;

    const parsed = safeJsonParse(item.response);
    const taskSnapshots = mergeTaskSnapshots(parsed);

    next.push({
      id: item.id || `subagent-tool-${normalizedToolName}-${index}`,
      toolName: item.toolName || normalizedToolName,
      params: item.params || "",
      response: item.response || "",
      taskSnapshots,
    });
  });

  return next;
};
