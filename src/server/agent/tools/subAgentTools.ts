import type { ChatCompletionMessageParam } from "@aistudio/ai/compat/global/core/ai/type";
import type { OpenaiAccountType } from "@aistudio/ai/compat/global/support/user/team/type";
import {
  closeSubAgent,
  getSubAgentResult,
  listSubAgents,
  resumeSubAgent,
  sendSubAgentInput,
  spawnSubAgent,
  SUB_AGENT_TOOL_NAMES,
  waitSubAgent,
} from "@server/agent/subagents/manager";
import type { AgentToolDefinition } from "./types";

const spawnAgentParameters = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "子代理要执行的具体任务。" },
    name: { type: "string", description: "可选，子代理名称（用于后续 send/wait/close）。" },
    model: { type: "string", description: "可选，子代理模型 ID。" },
    fork_context: {
      type: "boolean",
      description: "默认 true。true 时继承当前上下文，false 时从空上下文启动。",
    },
    isolation: {
      type: "string",
      enum: ["session", "worktree"],
      description: "隔离模式。session=仅会话隔离；worktree=git worktree 隔离。",
    },
    cwd: {
      type: "string",
      description: "可选，spawn 时的工作目录（worktree 模式下用于定位 git 根目录）。",
    },
    required_mcp_servers: {
      type: "array",
      items: { type: "string" },
      description: "可选，要求可用的 MCP server 名称列表。",
    },
    run_in_background: {
      type: "boolean",
      description: "Claude 风格字段。true=后台执行；false=前台阻塞等待完成或超时。",
    },
    timeout_ms: {
      type: "integer",
      minimum: 1000,
      maximum: 1800000,
      description: "可选。run_in_background=false 时，等待子代理执行完成的超时时间。",
    },
  },
  required: ["prompt"],
};

const sendInputParameters = {
  type: "object",
  properties: {
    target: { type: "string", description: "目标子代理 id 或 name。" },
    message: { type: "string", description: "发送给子代理的新输入消息。" },
    interrupt: {
      type: "boolean",
      description: "可选。true 时先中断当前执行再发送消息。",
    },
  },
  required: ["target", "message"],
};

const sendMessageParameters = {
  type: "object",
  properties: {
    to: { type: "string", description: "目标子代理 id 或 name。" },
    message: { type: "string", description: "发送给子代理的新消息。" },
    interrupt: {
      type: "boolean",
      description: "可选。true 时先中断当前执行再发送消息。",
    },
  },
  required: ["to", "message"],
};

const waitAgentParameters = {
  type: "object",
  properties: {
    target: { type: "string", description: "目标子代理 id 或 name。" },
    timeout_ms: {
      type: "integer",
      minimum: 1000,
      maximum: 300000,
      description: "等待超时时间，默认 30000ms。",
    },
  },
  required: ["target"],
};

const closeAgentParameters = {
  type: "object",
  properties: {
    target: { type: "string", description: "目标子代理 id 或 name。" },
  },
  required: ["target"],
};

const resumeAgentParameters = {
  type: "object",
  properties: {
    target: { type: "string", description: "目标子代理 id 或 name。" },
  },
  required: ["target"],
};

const getAgentResultParameters = {
  type: "object",
  properties: {
    target: { type: "string", description: "目标子代理 id 或 name。" },
    max_chars: {
      type: "integer",
      minimum: 200,
      maximum: 200000,
      description: "返回输出尾部的最大字符数，默认 8000。",
    },
  },
  required: ["target"],
};

const toString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const toBoolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;
const toInteger = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return fallback;
};

type CreateSubAgentToolsInput = {
  sessionId: string;
  getSelectedModel: () => string;
  recursionLimit?: number;
  temperature: number;
  userKey?: OpenaiAccountType;
  thinking?: { type: "enabled" | "disabled" };
  getContextMessages: () => ChatCompletionMessageParam[];
  getDelegatableTools: () => AgentToolDefinition[];
};

export const createSubAgentTools = ({
  sessionId,
  getSelectedModel,
  recursionLimit,
  temperature,
  userKey,
  thinking,
  getContextMessages,
  getDelegatableTools,
}: CreateSubAgentToolsInput): AgentToolDefinition[] => {
  const buildRuntime = () => ({
    sessionId,
    selectedModel: getSelectedModel(),
    recursionLimit: Math.max(2, Math.min(recursionLimit || 8, 30)),
    temperature,
    userKey,
    thinking,
    getContextMessages,
    getDelegatableTools: () =>
      getDelegatableTools().filter((tool) => !SUB_AGENT_TOOL_NAMES.has(tool.name)),
  });

  return [
    {
      name: "spawn_agent",
      description:
        "启动一个子代理（master + sub 架构）。子代理会异步执行任务，可通过 wait_agent 查询结果。",
      parameters: spawnAgentParameters,
      run: async (input) => {
        const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
        const prompt = toString(payload.prompt);
        if (!prompt) throw new Error("spawn_agent: prompt is required");
        const snapshot = await spawnSubAgent(buildRuntime(), {
          prompt,
          name: toString(payload.name) || undefined,
          model: toString(payload.model) || undefined,
          forkContext: toBoolean(payload.fork_context, true),
          isolation: toString(payload.isolation) === "worktree" ? "worktree" : "session",
          cwd: toString(payload.cwd) || undefined,
          requiredMcpServers: Array.isArray(payload.required_mcp_servers)
            ? payload.required_mcp_servers.map((item) => toString(item)).filter(Boolean)
            : undefined,
          runInBackground: toBoolean(payload.run_in_background, true),
          timeoutMs: toInteger(payload.timeout_ms, 300000),
        });
        return {
          ok: true,
          ...snapshot,
        };
      },
    },
    {
      name: "send_input",
      description: "向已存在子代理发送新消息，可选中断其当前执行。",
      parameters: sendInputParameters,
      run: async (input) => {
        const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
        const target = toString(payload.target);
        const message = toString(payload.message);
        if (!target) throw new Error("send_input: target is required");
        if (!message) throw new Error("send_input: message is required");
        const snapshot = sendSubAgentInput(buildRuntime(), {
          target,
          message,
          interrupt: toBoolean(payload.interrupt, false),
        });
        return {
          ok: true,
          ...snapshot,
        };
      },
    },
    {
      name: "send_message",
      description: "Claude 风格路由工具：向已存在子代理发送消息（等价 send_input）。",
      parameters: sendMessageParameters,
      run: async (input) => {
        const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
        const target = toString(payload.to);
        const message = toString(payload.message);
        if (!target) throw new Error("send_message: to is required");
        if (!message) throw new Error("send_message: message is required");
        const snapshot = sendSubAgentInput(buildRuntime(), {
          target,
          message,
          interrupt: toBoolean(payload.interrupt, false),
        });
        return {
          ok: true,
          ...snapshot,
        };
      },
    },
    {
      name: "wait_agent",
      description: "等待子代理完成或超时，返回当前状态与最后输出。",
      parameters: waitAgentParameters,
      run: async (input) => {
        const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
        const target = toString(payload.target);
        if (!target) throw new Error("wait_agent: target is required");
        const snapshot = await waitSubAgent(buildRuntime(), {
          target,
          timeoutMs: toInteger(payload.timeout_ms, 30000),
        });
        return {
          ok: true,
          ...snapshot,
        };
      },
    },
    {
      name: "resume_agent",
      description: "恢复已关闭的子代理，使其可继续接收 send_input。",
      parameters: resumeAgentParameters,
      run: async (input) => {
        const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
        const target = toString(payload.target);
        if (!target) throw new Error("resume_agent: target is required");
        const snapshot = resumeSubAgent(buildRuntime(), { target });
        return {
          ok: true,
          ...snapshot,
        };
      },
    },
    {
      name: "list_agents",
      description: "列出当前会话所有子代理任务状态，供任务面板展示。",
      parameters: {
        type: "object",
        properties: {},
      },
      run: async () => {
        const list = listSubAgents(buildRuntime());
        return {
          ok: true,
          agents: list,
        };
      },
    },
    {
      name: "get_agent_result",
      description: "读取子代理结果快照与输出尾部（用于后台任务跟踪）。",
      parameters: getAgentResultParameters,
      run: async (input) => {
        const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
        const target = toString(payload.target);
        if (!target) throw new Error("get_agent_result: target is required");
        const snapshot = await getSubAgentResult(buildRuntime(), {
          target,
          maxChars: toInteger(payload.max_chars, 8000),
        });
        return {
          ok: true,
          ...snapshot,
        };
      },
    },
    {
      name: "close_agent",
      description: "关闭子代理并停止其后续执行。",
      parameters: closeAgentParameters,
      run: async (input) => {
        const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
        const target = toString(payload.target);
        if (!target) throw new Error("close_agent: target is required");
        const snapshot = closeSubAgent(buildRuntime(), { target });
        return {
          ok: true,
          ...snapshot,
        };
      },
    },
  ];
};
