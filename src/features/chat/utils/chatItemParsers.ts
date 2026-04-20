import type { ConversationMessage } from "@/types/conversation";
import {
  isPlanInteractionEnvelope,
  type PlanInteractionEnvelope,
} from "@shared/chat/planInteraction";

export interface MessageFile {
  id?: string;
  name?: string;
  size?: number;
  type?: string;
  storagePath?: string;
  previewUrl?: string;
  downloadUrl?: string;
  parse?: {
    status?: "success" | "error" | "skipped";
    progress?: number;
    parser?: string;
    error?: string;
  };
}

export interface ToolDetail {
  id?: string;
  toolName?: string;
  params?: string;
  response?: string;
  parentAgentToolUseId?: string;
  interaction?: PlanInteractionEnvelope;
  progressStatus?: "pending" | "in_progress" | "completed" | "error";
}

export interface TimelineItem {
  type: "reasoning" | "answer" | "tool" | "agent";
  text?: string;
  id?: string;
  toolName?: string;
  agentType?: string;
  description?: string;
  prompt?: string;
  response?: string;
  usageSummary?: {
    totalTokens?: number;
    toolUses?: number;
    durationMs?: number;
  };
  skillTag?: string;
  params?: string;
  children?: TimelineItem[];
  parentAgentToolUseId?: string;
  interaction?: PlanInteractionEnvelope;
  progressStatus?: "pending" | "in_progress" | "completed" | "error";
}

export interface PlanQuestionOption {
  label: string;
  description?: string;
}

export interface PlanQuestion {
  requestId?: string;
  header: string;
  id: string;
  question: string;
  options: PlanQuestionOption[];
}

export interface PermissionApprovalState {
  toolName: string;
  toolUseId?: string;
  reason?: string;
}

export const MAX_TOOL_DETAIL_CHARS = 800;

export const PLAN_MODE_TOOL_NAMES = new Set([
  "enter_plan_mode",
  "exit_plan_mode",
  "request_user_input",
  "enterplanmode",
  "exitplanmode",
  "askuserquestion",
  "update_plan",
]);

const getSdkContentBlocks = (message: ConversationMessage): unknown[] | null => {
  const directContent =
    message.message && typeof message.message === "object"
      ? (message.message as { content?: unknown }).content
      : message.content;
  const directBlocks = Array.isArray(directContent) ? directContent : null;

  const kwargs =
    message.additional_kwargs && typeof message.additional_kwargs === "object"
      ? (message.additional_kwargs as Record<string, unknown>)
      : null;
  const sdkMessage =
    kwargs?.sdkMessage && typeof kwargs.sdkMessage === "object"
      ? (kwargs.sdkMessage as Record<string, unknown>)
      : null;
  const sdkPayload =
    sdkMessage?.message && typeof sdkMessage.message === "object"
      ? (sdkMessage.message as Record<string, unknown>)
      : null;
  const kwargsBlocks = Array.isArray(sdkPayload?.content) ? (sdkPayload.content as unknown[]) : null;

  if (!directBlocks && !kwargsBlocks) return null;
  if (directBlocks && !kwargsBlocks) return directBlocks;
  if (!directBlocks && kwargsBlocks) return kwargsBlocks;

  const scoreBlocks = (blocks: unknown[]) =>
    blocks.reduce<number>((score, block) => {
      if (!block || typeof block !== "object") return score;
      const item = block as Record<string, unknown>;
      const type = item.type;
      if (type === "tool_use") {
        const inputText = toStringValue(item.input).trim();
        // Prefer streams that carry actual tool input payloads.
        return score + 10 + Math.min(inputText.length, 200);
      }
      if (type === "tool_result") return score + 4;
      if (type === "thinking") return score + 1;
      if (type === "text") return score + 1;
      return score;
    }, 0);

  const directScore = scoreBlocks(directBlocks as unknown[]);
  const kwargsScore = scoreBlocks(kwargsBlocks as unknown[]);
  if (kwargsScore > directScore) return kwargsBlocks;
  return directBlocks;
};

const getInteractionByRequestId = (message: ConversationMessage): Map<string, PlanInteractionEnvelope> => {
  const map = new Map<string, PlanInteractionEnvelope>();
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return map;
  const controlEvents = (message.additional_kwargs as { controlEvents?: unknown }).controlEvents;
  if (!Array.isArray(controlEvents)) return map;
  for (const event of controlEvents) {
    if (!isPlanInteractionEnvelope(event)) continue;
    const requestId = event.requestId.trim();
    if (!requestId) continue;
    map.set(requestId, event);
  }
  return map;
};

const normalizeToolPayload = (value?: string) => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    return trimmed.replace(/\s+/g, " ");
  }
};

const toStringValue = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const mergeToolParams = (prev?: string, next?: string) => {
  const left = (prev || "").trim();
  const right = (next || "").trim();
  if (!left) return right;
  if (!right) return left;
  // Streaming tool_use input often starts with "{}" and then sends actual JSON.
  // Keep the richer payload instead of concatenating "{}" + "{...}".
  if (left === "{}") return right;
  if (right === "{}") return left;
  if (right.startsWith(left)) return right;
  if (left.startsWith(right)) return left;
  return `${left}${right}`;
};

const parseResultRecord = (value?: string): Record<string, unknown> | null => {
  const raw = (value || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const stringifyCmdArgs = (record: Record<string, unknown>) => {
  const cmd = typeof record.cmd === "string" ? record.cmd.trim() : "";
  const args = Array.isArray(record.args)
    ? (record.args as unknown[])
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  return [cmd, ...args].filter(Boolean).join(" ").trim();
};

const getToolResultDisplayPayload = (toolName: string | undefined, rawResponse: string) => {
  const record = parseResultRecord(rawResponse);
  if (!record) {
    const normalizedToolName = (toolName || "").trim().toLowerCase();
    if (isAgentToolName(normalizedToolName)) {
      const parsedAgent = parseAgentResponseParts(rawResponse);
      return {
        response: parsedAgent.response,
        paramsFallback: "",
      };
    }
    return {
      response: rawResponse,
      paramsFallback: "",
    };
  }

  const paramsFallback = stringifyCmdArgs(record);
  const content = typeof record.content === "string" ? record.content : "";
  if (content) {
    return {
      response: content,
      paramsFallback,
    };
  }

  const normalizedToolName = (toolName || "").trim().toLowerCase();
  if (normalizedToolName === "read") {
    const file = record.file && typeof record.file === "object" && !Array.isArray(record.file)
      ? (record.file as Record<string, unknown>)
      : null;
    const fileContent = typeof file?.content === "string" ? file.content : "";
    const filePath = typeof file?.filePath === "string" ? file.filePath : "";
    if (fileContent) {
      return {
        response: fileContent,
        paramsFallback: filePath || paramsFallback,
      };
    }
  }

  if (normalizedToolName === "bash") {
    const stdout = typeof record.stdout === "string" ? record.stdout : "";
    const stderr = typeof record.stderr === "string" ? record.stderr : "";
    const error = typeof record.error === "string" ? record.error : "";
    const response = stdout || stderr || error || rawResponse;
    return {
      response,
      paramsFallback,
    };
  }

  return {
    response: rawResponse,
    paramsFallback,
  };
};

const extractSkillTag = ({
  toolName,
  params,
  response,
}: {
  toolName?: string;
  params?: string;
  response?: string;
}): string => {
  const normalizedToolName = (toolName || "").trim().toLowerCase();
  if (normalizedToolName !== "skill") return "";

  const parseRecord = (value?: string): Record<string, unknown> | null => {
    const raw = (value || "").trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const fromParams = parseRecord(params);
  if (typeof fromParams?.skill === "string" && fromParams.skill.trim()) {
    const normalized = fromParams.skill.trim().replace(/^\//, "");
    if (normalized) return normalized;
  }

  const fromResult = parseRecord(response);
  if (typeof fromResult?.commandName === "string" && fromResult.commandName.trim()) {
    const normalized = fromResult.commandName.trim().replace(/^\//, "");
    if (normalized) return normalized;
  }
  return "";
};

const getToolFingerprint = (toolName?: string, params?: string, response?: string) => {
  const normalizedName = (toolName || "").trim().toLowerCase();
  const normalizedParams = normalizeToolPayload(params);
  const normalizedResponse = normalizeToolPayload(response);
  return `${normalizedName}::${normalizedParams}::${normalizedResponse}`;
};

const getAgentDisplayName = (agentType?: string) => {
  const normalized = (agentType || "").trim();
  if (!normalized) return "子 Agent";
  return normalized;
};

const isAgentToolName = (toolName?: string) => {
  const normalized = (toolName || "").trim().toLowerCase();
  return normalized === "agent" || normalized === "task";
};

const parseAgentResponseParts = (rawResponse: string) => {
  try {
    const parsed = JSON.parse(rawResponse);
    if (!Array.isArray(parsed)) {
      return {
        response: rawResponse,
        usageSummary: undefined as TimelineItem["usageSummary"],
      };
    }

    const textParts = parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      .map((item) => (typeof item.text === "string" ? item.text.trim() : ""))
      .filter(Boolean);
    const usageCarrier = textParts.find((item) => item.includes("<usage>")) || "";
    const cleanedResponse = textParts
      .map((item) => item.replace(/agentId:\s*[^\n]+/g, "").replace(/<usage>[\s\S]*?<\/usage>/g, "").trim())
      .filter(Boolean)
      .join("\n\n");
    const totalTokensMatch = usageCarrier.match(/total_tokens:\s*(\d+)/);
    const toolUsesMatch = usageCarrier.match(/tool_uses:\s*(\d+)/);
    const durationMsMatch = usageCarrier.match(/duration_ms:\s*(\d+)/);

    return {
      response: cleanedResponse || rawResponse,
      usageSummary:
        totalTokensMatch || toolUsesMatch || durationMsMatch
          ? {
              ...(totalTokensMatch ? { totalTokens: Number(totalTokensMatch[1]) } : {}),
              ...(toolUsesMatch ? { toolUses: Number(toolUsesMatch[1]) } : {}),
              ...(durationMsMatch ? { durationMs: Number(durationMsMatch[1]) } : {}),
            }
          : undefined,
    };
  } catch {
    return {
      response: rawResponse,
      usageSummary: undefined as TimelineItem["usageSummary"],
    };
  }
};

export const getMessageFiles = (message: ConversationMessage): MessageFile[] => {
  if (!message.artifact || typeof message.artifact !== "object") return [];
  const files = (message.artifact as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  return files.filter((file): file is MessageFile => Boolean(file && typeof file === "object"));
};

export const isImageFile = (file: MessageFile) => {
  if (typeof file.type === "string" && file.type.startsWith("image/")) return true;
  const name = typeof file.name === "string" ? file.name.toLowerCase() : "";
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"].some((ext) =>
    name.endsWith(ext)
  );
};

export const getToolDetails = (message: ConversationMessage): ToolDetail[] => {
  const sdkContent = getSdkContentBlocks(message);
  const interactionByRequestId = getInteractionByRequestId(message);
  if (Array.isArray(sdkContent)) {
    const details: ToolDetail[] = [];
    const byId = new Map<string, ToolDetail>();
    for (const block of sdkContent) {
      if (!block || typeof block !== "object") continue;
      const item = block as Record<string, unknown>;
      if (item.type === "agent_start" && typeof item.id === "string") {
        details.push({
          id: item.id,
          toolName: getAgentDisplayName(typeof item.agent_type === "string" ? item.agent_type : ""),
          params:
            typeof item.prompt === "string" && item.prompt.trim()
              ? item.prompt
              : typeof item.description === "string"
              ? item.description
              : "",
          response: "",
          progressStatus: "in_progress",
        });
        continue;
      }
      if (item.type === "tool_use" && typeof item.id === "string") {
        const id = item.id;
        const toolName = typeof item.name === "string" ? item.name : "tool";
        const params = item.input ? toStringValue(item.input) : "";
        const parentAgentToolUseId =
          typeof item.parent_agent_tool_use_id === "string" && item.parent_agent_tool_use_id.trim()
            ? item.parent_agent_tool_use_id.trim()
            : "";
        const existing = byId.get(id);
        if (existing) {
          if (!existing.toolName && toolName) existing.toolName = toolName;
          if (params) {
            existing.params = mergeToolParams(existing.params, params);
          }
          if (!existing.parentAgentToolUseId && parentAgentToolUseId) {
            existing.parentAgentToolUseId = parentAgentToolUseId;
          }
          if (!existing.progressStatus) existing.progressStatus = "in_progress";
          if (!existing.interaction) existing.interaction = interactionByRequestId.get(id);
        } else {
          const next: ToolDetail = {
            id,
            toolName,
            params,
            response: "",
            interaction: interactionByRequestId.get(id),
            ...(parentAgentToolUseId ? { parentAgentToolUseId } : {}),
            progressStatus: "in_progress",
          };
          byId.set(id, next);
          details.push(next);
        }
        continue;
      }
      if (item.type === "tool_result" && typeof item.tool_use_id === "string") {
        const id = item.tool_use_id;
        const target = byId.get(id);
        const responseRaw = typeof item.content === "string" ? item.content : toStringValue(item.content);
        const status = item.is_error === true ? "error" : "completed";
        const parentAgentToolUseId =
          typeof item.parent_agent_tool_use_id === "string" && item.parent_agent_tool_use_id.trim()
            ? item.parent_agent_tool_use_id.trim()
            : "";
        const toolName =
          target?.toolName || (typeof item.name === "string" && item.name.trim() ? item.name : undefined);
        const display = getToolResultDisplayPayload(toolName, responseRaw);
        if (target) {
          target.response = display.response;
          target.progressStatus = status;
          if (!target.parentAgentToolUseId && parentAgentToolUseId) {
            target.parentAgentToolUseId = parentAgentToolUseId;
          }
          if (!target.interaction) target.interaction = interactionByRequestId.get(id);
          if (!target.params) {
            const fallback = item.input ? toStringValue(item.input) : display.paramsFallback;
            if (fallback) target.params = fallback;
          }
        } else {
          details.push({
            id,
            toolName:
              typeof item.name === "string" && item.name.trim() ? item.name : "工具调用",
            params: item.input ? toStringValue(item.input) : display.paramsFallback || "",
            response: display.response,
            interaction: interactionByRequestId.get(id),
            ...(parentAgentToolUseId ? { parentAgentToolUseId } : {}),
            progressStatus: status,
          });
        }
      }
    }
    if (details.length > 0) return details;
  }
  return [];
};

export const getReasoningText = (message: ConversationMessage): string => {
  const sdkContent = getSdkContentBlocks(message);
  if (Array.isArray(sdkContent)) {
    const text = sdkContent
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const item = block as Record<string, unknown>;
        return item.type === "thinking" && typeof item.thinking === "string" ? item.thinking : "";
      })
      .join("");
    if (text.trim()) return text;
  }

  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return "";
  const kwargs = message.additional_kwargs as {
    reasoning_text?: unknown;
    reasoning_content?: unknown;
  };
  const value = kwargs.reasoning_text ?? kwargs.reasoning_content;
  return typeof value === "string" ? value : "";
};

export const getTimelineItems = (message: ConversationMessage): TimelineItem[] => {
  const sdkContent = getSdkContentBlocks(message);
  const interactionByRequestId = getInteractionByRequestId(message);
  if (Array.isArray(sdkContent)) {
    const timeline: TimelineItem[] = [];
    const toolLocationById = new Map<string, { scope: "root"; index: number } | { scope: "agent"; agentIndex: number; childIndex: number }>();
    const agentIndexById = new Map<string, number>();
    for (const block of sdkContent) {
      if (!block || typeof block !== "object") continue;
      const item = block as Record<string, unknown>;
      if (item.type === "agent_start" && typeof item.id === "string") {
        const index =
          timeline.push({
            type: "agent",
            id: item.id,
            agentType: getAgentDisplayName(typeof item.agent_type === "string" ? item.agent_type : ""),
            description: typeof item.description === "string" ? item.description : "",
            prompt: typeof item.prompt === "string" ? item.prompt : "",
            children: [],
            progressStatus: "in_progress",
          }) - 1;
        agentIndexById.set(item.id, index);
        continue;
      }
      if (item.type === "thinking" && typeof item.thinking === "string") {
        timeline.push({ type: "reasoning", text: item.thinking });
        continue;
      }
      if (item.type === "text" && typeof item.text === "string") {
        timeline.push({ type: "answer", text: item.text });
        continue;
      }
      if (item.type === "tool_use" && typeof item.id === "string") {
        const parentAgentToolUseId =
          typeof item.parent_agent_tool_use_id === "string" && item.parent_agent_tool_use_id.trim()
            ? item.parent_agent_tool_use_id.trim()
            : "";
        const toolName = typeof item.name === "string" ? item.name : "tool";
        if (!parentAgentToolUseId && isAgentToolName(toolName)) {
          continue;
        }
        const params = item.input ? toStringValue(item.input) : undefined;
        const existingLocation = toolLocationById.get(item.id);
        if (existingLocation?.scope === "root" && timeline[existingLocation.index]) {
          const existing = timeline[existingLocation.index];
          timeline[existingLocation.index] = {
            ...existing,
            toolName:
              existing.toolName && existing.toolName !== "tool"
                ? existing.toolName
                : typeof item.name === "string"
                ? item.name
                : existing.toolName,
            params: mergeToolParams(existing.params, params),
            parentAgentToolUseId: existing.parentAgentToolUseId || parentAgentToolUseId || undefined,
            progressStatus: existing.progressStatus || "in_progress",
            interaction: existing.interaction || interactionByRequestId.get(item.id),
          };
        } else if (existingLocation?.scope === "agent") {
          const parentAgent = timeline[existingLocation.agentIndex];
          if (parentAgent?.type === "agent" && Array.isArray(parentAgent.children)) {
            const children = [...parentAgent.children];
            const existing = children[existingLocation.childIndex];
            if (existing) {
              children[existingLocation.childIndex] = {
                ...existing,
                toolName:
                  existing.toolName && existing.toolName !== "tool"
                    ? existing.toolName
                    : typeof item.name === "string"
                    ? item.name
                    : existing.toolName,
                params: mergeToolParams(existing.params, params),
                parentAgentToolUseId: existing.parentAgentToolUseId || parentAgentToolUseId || undefined,
                progressStatus: existing.progressStatus || "in_progress",
                interaction: existing.interaction || interactionByRequestId.get(item.id),
              };
              timeline[existingLocation.agentIndex] = {
                ...parentAgent,
                children,
              };
            }
          }
        } else {
          const nextTool: TimelineItem = {
            type: "tool",
            id: item.id,
            toolName,
            params,
            ...(parentAgentToolUseId ? { parentAgentToolUseId } : {}),
            interaction: interactionByRequestId.get(item.id),
            progressStatus: "in_progress",
          };
          if (parentAgentToolUseId) {
            const agentIndex = agentIndexById.get(parentAgentToolUseId);
            const parentAgent = typeof agentIndex === "number" ? timeline[agentIndex] : undefined;
            if (parentAgent && parentAgent.type === "agent") {
              const children = Array.isArray(parentAgent.children) ? [...parentAgent.children, nextTool] : [nextTool];
              const childIndex = children.length - 1;
              if (typeof agentIndex === "number") {
                timeline[agentIndex] = {
                  ...parentAgent,
                  children,
                };
                toolLocationById.set(item.id, { scope: "agent", agentIndex, childIndex });
              }
              continue;
            }
          }
          const index = timeline.push(nextTool) - 1;
          toolLocationById.set(item.id, { scope: "root", index });
        }
        continue;
      }
      if (item.type === "tool_result" && typeof item.tool_use_id === "string") {
        const location = toolLocationById.get(item.tool_use_id);
        const responseRaw = typeof item.content === "string" ? item.content : toStringValue(item.content);
        const status = item.is_error === true ? "error" : "completed";
        const parentAgentToolUseId =
          typeof item.parent_agent_tool_use_id === "string" && item.parent_agent_tool_use_id.trim()
            ? item.parent_agent_tool_use_id.trim()
            : "";
        const resultToolName =
          typeof item.name === "string" && item.name.trim() ? item.name.trim() : "";
        const directAgentIndex = agentIndexById.get(item.tool_use_id);
        if (!parentAgentToolUseId && directAgentIndex !== undefined && isAgentToolName(resultToolName)) {
          const target = timeline[directAgentIndex];
          if (target?.type === "agent") {
            const parsedAgent = parseAgentResponseParts(responseRaw);
            timeline[directAgentIndex] = {
              ...target,
              response:
                (target.response?.length || 0) >= (parsedAgent.response?.length || 0)
                  ? target.response
                  : parsedAgent.response,
              usageSummary: parsedAgent.usageSummary || target.usageSummary,
              progressStatus: status,
            };
          }
          continue;
        }
        if (location?.scope === "root" && timeline[location.index]) {
          const target = timeline[location.index];
          const display = getToolResultDisplayPayload(target.toolName, responseRaw);
          const skillTag = extractSkillTag({
            toolName: target.toolName,
            params: target.params,
            response: display.response,
          });
          timeline[location.index] = {
            ...target,
            response: display.response,
            params: target.params || display.paramsFallback || target.params,
            ...(skillTag ? { skillTag } : {}),
            interaction: target.interaction || interactionByRequestId.get(item.tool_use_id),
            progressStatus: status,
          };
        } else if (location?.scope === "agent") {
          const parentAgent = timeline[location.agentIndex];
          if (parentAgent?.type === "agent" && Array.isArray(parentAgent.children)) {
            const children = [...parentAgent.children];
            const target = children[location.childIndex];
            if (target) {
              const display = getToolResultDisplayPayload(target.toolName, responseRaw);
              const skillTag = extractSkillTag({
                toolName: target.toolName,
                params: target.params,
                response: display.response,
              });
              children[location.childIndex] = {
                ...target,
                response: display.response,
                params: target.params || display.paramsFallback || target.params,
                ...(skillTag ? { skillTag } : {}),
                interaction: target.interaction || interactionByRequestId.get(item.tool_use_id),
                progressStatus: status,
              };
              timeline[location.agentIndex] = {
                ...parentAgent,
                children,
              };
            }
          }
        } else {
          const toolName =
            typeof item.name === "string" && item.name.trim() ? item.name : "工具调用";
          const params = item.input ? toStringValue(item.input) : "";
          const display = getToolResultDisplayPayload(toolName, responseRaw);
          const skillTag = extractSkillTag({
            toolName,
            params: params || display.paramsFallback || "",
            response: display.response,
          });
          const nextTool: TimelineItem = {
            type: "tool",
            id: item.tool_use_id,
            toolName,
            params: params || display.paramsFallback || "",
            response: display.response,
            ...(parentAgentToolUseId ? { parentAgentToolUseId } : {}),
            ...(skillTag ? { skillTag } : {}),
            interaction: interactionByRequestId.get(item.tool_use_id),
            progressStatus: status,
          };
          const agentIndex = parentAgentToolUseId ? agentIndexById.get(parentAgentToolUseId) : undefined;
          const parentAgent = typeof agentIndex === "number" ? timeline[agentIndex] : undefined;
          if (parentAgent && parentAgent.type === "agent") {
            const children = Array.isArray(parentAgent.children) ? [...parentAgent.children, nextTool] : [nextTool];
            const childIndex = children.length - 1;
            if (typeof agentIndex === "number") {
              timeline[agentIndex] = {
                ...parentAgent,
                children,
              };
              toolLocationById.set(item.tool_use_id, { scope: "agent", agentIndex, childIndex });
            }
          } else {
            const index = timeline.push(nextTool) - 1;
            toolLocationById.set(item.tool_use_id, { scope: "root", index });
          }
        }
      }
    }
    if (timeline.length > 0) return timeline;
  }
  return [];
};

export const getPlanQuestions = (message: ConversationMessage): PlanQuestion[] => {
  const kwargs =
    message.additional_kwargs && typeof message.additional_kwargs === "object"
      ? (message.additional_kwargs as Record<string, unknown>)
      : null;
  const interactionState =
    kwargs?.planModeInteractionState &&
    typeof kwargs.planModeInteractionState === "object" &&
    !Array.isArray(kwargs.planModeInteractionState)
      ? (kwargs.planModeInteractionState as Record<string, unknown>)
      : {};

  const isRequestSubmitted = (requestId?: string) => {
    if (!requestId) return false;
    const state = interactionState[requestId];
    if (!state || typeof state !== "object" || Array.isArray(state)) return false;
    const status = (state as { status?: unknown }).status;
    return status === "submitted";
  };
  const isRequestSuperseded = (requestId?: string) => {
    if (!requestId) return false;
    const state = interactionState[requestId];
    if (!state || typeof state !== "object" || Array.isArray(state)) return false;
    const status = (state as { status?: unknown }).status;
    return status === "superseded";
  };

  const controlEvents =
    kwargs && typeof kwargs === "object" ? (kwargs as { controlEvents?: unknown }).controlEvents : undefined;
  if (Array.isArray(controlEvents)) {
    const questions = controlEvents
      .filter((item): item is PlanInteractionEnvelope => isPlanInteractionEnvelope(item))
      .filter((item) => item.type === "plan_question")
      .filter((item) => !isRequestSubmitted(item.requestId))
      .filter((item) => !isRequestSuperseded(item.requestId))
      .flatMap((item) => {
        const payload =
          item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
            ? (item.payload as Record<string, unknown>)
            : null;
        const list = payload && Array.isArray(payload.questions) ? payload.questions : [];
        return list
          .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
          .map((value) => ({
            requestId: item.requestId,
            header: typeof value.header === "string" ? value.header : "确认",
            id: typeof value.id === "string" ? value.id : "",
            question: typeof value.question === "string" ? value.question : "",
            options: Array.isArray(value.options)
              ? value.options
                  .filter((opt): opt is Record<string, unknown> => Boolean(opt && typeof opt === "object"))
                  .map((opt) => ({
                    label: typeof opt.label === "string" ? opt.label : "",
                    description: typeof opt.description === "string" ? opt.description : "",
                  }))
                  .filter((opt) => opt.label.trim().length > 0)
              : [],
          }));
      })
      .filter((item) => item.id && item.question);
    if (questions.length > 0) {
      const latestRequestId = questions[questions.length - 1]?.requestId;
      if (latestRequestId) {
        return questions.filter((item) => item.requestId === latestRequestId);
      }
      return questions;
    }
  }
  return [];
};

export const getPlanModeApprovalDecision = (message: ConversationMessage): "approve" | "reject" | "" => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return "";
  const kwargs = message.additional_kwargs as Record<string, unknown>;
  const interactionState =
    kwargs.planModeInteractionState &&
    typeof kwargs.planModeInteractionState === "object" &&
    !Array.isArray(kwargs.planModeInteractionState)
      ? (kwargs.planModeInteractionState as Record<string, unknown>)
      : {};
  const submittedEntry = Object.values(interactionState).find((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return record.type === "plan_approval" && record.status === "submitted";
  });
  if (!submittedEntry || typeof submittedEntry !== "object" || Array.isArray(submittedEntry)) return "";
  const decision = (submittedEntry as { decision?: unknown }).decision;
  return decision === "approve" || decision === "reject" ? decision : "";
};

export const getPlanModeApprovalPending = (message: ConversationMessage): boolean => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return false;
  const kwargs = message.additional_kwargs as Record<string, unknown>;
  const approval =
    kwargs.planModeApproval && typeof kwargs.planModeApproval === "object" && !Array.isArray(kwargs.planModeApproval)
      ? (kwargs.planModeApproval as Record<string, unknown>)
      : null;
  const requestId = typeof approval?.requestId === "string" ? approval.requestId.trim() : "";
  if (!requestId) return false;
  const interactionState =
    kwargs.planModeInteractionState &&
    typeof kwargs.planModeInteractionState === "object" &&
    !Array.isArray(kwargs.planModeInteractionState)
      ? (kwargs.planModeInteractionState as Record<string, unknown>)
      : {};
  const state = interactionState[requestId];
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  return (state as { status?: unknown }).status === "pending";
};

export const getPlanPreview = (message: ConversationMessage): string => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return "";
  const kwargs = message.additional_kwargs as Record<string, unknown>;
  const progress =
    kwargs.planProgress && typeof kwargs.planProgress === "object" && !Array.isArray(kwargs.planProgress)
      ? (kwargs.planProgress as Record<string, unknown>)
      : null;
  if (!progress) return "";
  const plan = Array.isArray(progress.plan) ? progress.plan : [];
  const lines = plan
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return "";
      const step = typeof (item as { step?: unknown }).step === "string" ? (item as { step: string }).step.trim() : "";
      if (!step) return "";
      return `- ${step}`;
    })
    .filter(Boolean);
  return lines.join("\n");
};

export const getPermissionApproval = (message: ConversationMessage): PermissionApprovalState | null => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return null;
  const kwargs = message.additional_kwargs as Record<string, unknown>;
  const raw = (kwargs as { permissionApproval?: unknown }).permissionApproval;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const toolName = typeof record.toolName === "string" ? record.toolName.trim() : "";
  if (!toolName) return null;
  const toolUseId = typeof record.toolUseId === "string" && record.toolUseId.trim() ? record.toolUseId.trim() : undefined;
  const reason = typeof record.reason === "string" && record.reason.trim() ? record.reason.trim() : undefined;
  const stateRecord =
    kwargs.permissionApprovalState &&
    typeof kwargs.permissionApprovalState === "object" &&
    !Array.isArray(kwargs.permissionApprovalState)
      ? (kwargs.permissionApprovalState as Record<string, unknown>)
      : {};
  const stateKey = toolUseId || toolName.trim().toLowerCase();
  const stateValue = stateKey ? stateRecord[stateKey] : undefined;
  if (stateValue && typeof stateValue === "object" && !Array.isArray(stateValue)) {
    const status = (stateValue as { status?: unknown }).status;
    if (status && status !== "pending") return null;
  }
  return {
    toolName,
    ...(toolUseId ? { toolUseId } : {}),
    ...(reason ? { reason } : {}),
  };
};

export const getPermissionApprovalDecision = (message: ConversationMessage): "approve" | "reject" | "" => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return "";
  const kwargs = message.additional_kwargs as Record<string, unknown>;
  const stateRecord =
    kwargs.permissionApprovalState &&
    typeof kwargs.permissionApprovalState === "object" &&
    !Array.isArray(kwargs.permissionApprovalState)
      ? (kwargs.permissionApprovalState as Record<string, unknown>)
      : {};
  for (const value of Object.values(stateRecord)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (record.status !== "submitted") continue;
    if (record.decision === "approve" || record.decision === "reject") {
      return record.decision;
    }
  }
  return "";
};

export const getRunStatus = (
  message: ConversationMessage,
  isStreaming?: boolean
): "running" | "success" | "error" => {
  if (isStreaming) return "running";
  if (message.status === "error") return "error";
  return "success";
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const toValidDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

export const formatExecutionTimeForHeader = (value: unknown): string | null => {
  const d = toValidDate(value);
  if (!d) return null;

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();

  const isSameDay =
    now.getFullYear() === d.getFullYear() && now.getMonth() === d.getMonth() && now.getDate() === d.getDate();

  const formatHMS = (date: Date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  const formatYMD = (date: Date) =>
    `${date.getFullYear()}年${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日`;

  if (diffMs < 0) return formatHMS(d);
  if (diffMs <= 10_000) return "刚刚";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}秒前`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}分钟前`;
  if (isSameDay) return formatHMS(d);
  return formatYMD(d);
};

export const getPathTailLabel = (value: string): string => {
  const normalized = (value || "").replace(/\\/g, "/");
  const base = normalized.split("/").filter(Boolean).pop() || value;
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
};

export const composeTimelineItems = ({
  rawTimelineItems,
  reasoningText,
  toolDetails,
}: {
  rawTimelineItems: TimelineItem[];
  reasoningText: string;
  toolDetails: ToolDetail[];
}): TimelineItem[] => {
  const next: TimelineItem[] = [];

  rawTimelineItems.forEach((item) => {
    if (item.type === "agent") {
      next.push({ ...item });
      return;
    }
    if ((item.type === "reasoning" || item.type === "answer") && typeof item.text === "string") {
      const last = next[next.length - 1];
      if (last && last.type === item.type && typeof last.text === "string") {
        next[next.length - 1] = {
          ...last,
          text: `${last.text}${item.text}`,
        };
        return;
      }
      next.push({ ...item });
      return;
    }
    next.push({ ...item });
  });

  const normalizedReasoning = reasoningText.trim();
  const hasReasoningInTimeline = next.some(
    (item) => item.type === "reasoning" && typeof item.text === "string" && item.text.trim().length > 0
  );

  if (!hasReasoningInTimeline && normalizedReasoning) {
    next.unshift({
      type: "reasoning",
      id: "reasoning",
      text: normalizedReasoning,
    });
  }

  if (toolDetails.length === 0) return next;

  const timelineToolIndexById = new Map<string, number>();
  const timelineToolIndexByFingerprint = new Map<string, number>();
  const timelineAgentIndexById = new Map<string, number>();
  const timelineAgentChildIndexById = new Map<string, { agentIndex: number; childIndex: number }>();
  next.forEach((item, index) => {
    if (item.type === "agent" && typeof item.id === "string" && item.id) {
      timelineAgentIndexById.set(item.id, index);
      if (Array.isArray(item.children)) {
        item.children.forEach((child, childIndex) => {
          if (child.type === "tool" && typeof child.id === "string" && child.id) {
            timelineAgentChildIndexById.set(child.id, { agentIndex: index, childIndex });
          }
        });
      }
      return;
    }
    if (item.type !== "tool") return;
    timelineToolIndexByFingerprint.set(getToolFingerprint(item.toolName, item.params, item.response), index);
    if (typeof item.id === "string" && item.id) {
      timelineToolIndexById.set(item.id, index);
    }
  });

  toolDetails.forEach((tool) => {
    const toolId = typeof tool.id === "string" && tool.id ? tool.id : undefined;
    const normalizedToolName = (tool.toolName || "").trim().toLowerCase();
    if (toolId) {
      const agentIndex = timelineAgentIndexById.get(toolId);
      if (agentIndex !== undefined) {
        const target = next[agentIndex];
        if (target?.type === "agent") {
          next[agentIndex] = {
            ...target,
            description: target.description || tool.toolName || target.description,
            prompt: target.prompt || tool.params || target.prompt,
            response:
              (target.response?.length || 0) >= (tool.response?.length || 0)
                ? target.response
                : tool.response,
            interaction: target.interaction || tool.interaction,
            progressStatus: target.progressStatus || tool.progressStatus,
          };
        }
        if (normalizedToolName === "agent") {
          return;
        }
      }
    }
    if (isAgentToolName(tool.toolName)) {
      return;
    }
    if (toolId) {
      const agentChildLocation = timelineAgentChildIndexById.get(toolId);
      if (agentChildLocation) {
        const parentAgent = next[agentChildLocation.agentIndex];
        if (parentAgent?.type === "agent" && Array.isArray(parentAgent.children)) {
          const children = [...parentAgent.children];
          const target = children[agentChildLocation.childIndex];
          if (target) {
            children[agentChildLocation.childIndex] = {
              ...target,
              toolName: target.toolName || tool.toolName,
              params: target.params && target.params.length >= (tool.params?.length || 0) ? target.params : tool.params,
              response:
                (target.response?.length || 0) >= (tool.response?.length || 0)
                  ? target.response
                  : tool.response,
              interaction: target.interaction || tool.interaction,
              progressStatus: target.progressStatus || tool.progressStatus,
            };
            next[agentChildLocation.agentIndex] = {
              ...parentAgent,
              children,
            };
            return;
          }
        }
      }
    }
    if (toolId) {
      const targetIndex = timelineToolIndexById.get(toolId);
      if (targetIndex !== undefined) {
        const target = next[targetIndex];
        next[targetIndex] = {
          ...target,
          toolName: target.toolName || tool.toolName,
          params: target.params && target.params.length >= (tool.params?.length || 0) ? target.params : tool.params,
          response:
            (target.response?.length || 0) >= (tool.response?.length || 0)
              ? target.response
              : tool.response,
          ...(extractSkillTag({
            toolName: target.toolName || tool.toolName,
            params:
              target.params && target.params.length >= (tool.params?.length || 0)
                ? target.params
                : tool.params,
            response:
              (target.response?.length || 0) >= (tool.response?.length || 0)
                ? target.response
                : tool.response,
          })
            ? {
                skillTag: extractSkillTag({
                  toolName: target.toolName || tool.toolName,
                  params:
                    target.params && target.params.length >= (tool.params?.length || 0)
                      ? target.params
                      : tool.params,
                  response:
                    (target.response?.length || 0) >= (tool.response?.length || 0)
                      ? target.response
                      : tool.response,
                }),
              }
            : {}),
          interaction: target.interaction || tool.interaction,
          progressStatus: target.progressStatus || tool.progressStatus,
        };
        return;
      }
    }

    const parentAgentToolUseId =
      typeof tool.parentAgentToolUseId === "string" && tool.parentAgentToolUseId.trim()
        ? tool.parentAgentToolUseId.trim()
        : "";
    if (parentAgentToolUseId) {
      const agentIndex = timelineAgentIndexById.get(parentAgentToolUseId);
      const parentAgent = typeof agentIndex === "number" ? next[agentIndex] : undefined;
      if (parentAgent?.type === "agent") {
        const children = Array.isArray(parentAgent.children) ? [...parentAgent.children] : [];
        const childIndex =
          children.push({
            type: "tool",
            id: toolId,
            toolName: tool.toolName || "",
            params: tool.params || "",
            response: tool.response || "",
            parentAgentToolUseId,
            interaction: tool.interaction,
            progressStatus: tool.progressStatus,
          }) - 1;
        if (typeof agentIndex === "number") {
          next[agentIndex] = {
            ...parentAgent,
            children,
          };
          if (toolId) timelineAgentChildIndexById.set(toolId, { agentIndex, childIndex });
        }
        return;
      }
    }
    const toolFingerprint = getToolFingerprint(tool.toolName, tool.params, tool.response);
    const targetIndexByFingerprint = timelineToolIndexByFingerprint.get(toolFingerprint);
    if (targetIndexByFingerprint !== undefined) {
      const target = next[targetIndexByFingerprint];
      next[targetIndexByFingerprint] = {
        ...target,
        toolName: target.toolName || tool.toolName,
        params: target.params && target.params.length >= (tool.params?.length || 0) ? target.params : tool.params,
        response:
          (target.response?.length || 0) >= (tool.response?.length || 0)
            ? target.response
            : tool.response,
        ...(extractSkillTag({
          toolName: target.toolName || tool.toolName,
          params:
            target.params && target.params.length >= (tool.params?.length || 0)
              ? target.params
              : tool.params,
          response:
            (target.response?.length || 0) >= (tool.response?.length || 0)
              ? target.response
              : tool.response,
        })
          ? {
              skillTag: extractSkillTag({
                toolName: target.toolName || tool.toolName,
                params:
                  target.params && target.params.length >= (tool.params?.length || 0)
                    ? target.params
                    : tool.params,
                response:
                  (target.response?.length || 0) >= (tool.response?.length || 0)
                    ? target.response
                    : tool.response,
              }),
            }
          : {}),
        interaction: target.interaction || tool.interaction,
        progressStatus: target.progressStatus || tool.progressStatus,
      };
      return;
    }

    const insertedIndex =
      next.push({
        type: "tool",
        id: toolId,
        toolName: tool.toolName || "",
        params: tool.params || "",
        response: tool.response || "",
        ...(extractSkillTag({
          toolName: tool.toolName || "",
          params: tool.params || "",
          response: tool.response || "",
        })
          ? {
              skillTag: extractSkillTag({
                toolName: tool.toolName || "",
                params: tool.params || "",
                response: tool.response || "",
              }),
            }
          : {}),
        interaction: tool.interaction,
        progressStatus: tool.progressStatus,
      }) - 1;
    if (toolId) timelineToolIndexById.set(toolId, insertedIndex);
    timelineToolIndexByFingerprint.set(toolFingerprint, insertedIndex);
  });

  return next;
};

export const truncateDetailText = (value?: string) => {
  if (!value) return "";
  const normalized = value.trim();
  if (normalized.length <= MAX_TOOL_DETAIL_CHARS) return normalized;
  return `${normalized.slice(0, MAX_TOOL_DETAIL_CHARS)}\n...`;
};

export const isDetailTruncated = (value?: string) => {
  if (!value) return false;
  return value.trim().length > MAX_TOOL_DETAIL_CHARS;
};
