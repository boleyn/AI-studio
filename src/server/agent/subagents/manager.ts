import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "@aistudio/ai/compat/global/core/ai/type";
import type { OpenaiAccountType } from "@aistudio/ai/compat/global/support/user/team/type";
import { runMasterSubAgentRuntime } from "@server/agent/runtime/masterSubAgentRuntime";
import { runSubagentHooks } from "@server/agent/hooks/runner";
import { getMcpServerStatuses, getMcpServerToolMap } from "@server/agent/mcpClient";
import type { AgentToolDefinition } from "@server/agent/tools/types";
import { existsSync, mkdirSync, promises as fs, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type AgentStatus = "running" | "completed" | "failed" | "closed";
type AgentIsolation = "session" | "worktree";

type SpawnAgentInput = {
  name?: string;
  prompt: string;
  model?: string;
  forkContext?: boolean;
  isolation?: AgentIsolation;
  cwd?: string;
  requiredMcpServers?: string[];
  runInBackground?: boolean;
};

type SendAgentInput = {
  target: string;
  message: string;
  interrupt?: boolean;
};

type WaitAgentInput = {
  target: string;
  timeoutMs?: number;
};

type CloseAgentInput = {
  target: string;
};

type AgentRuntimeOptions = {
  sessionId: string;
  selectedModel: string;
  recursionLimit?: number;
  temperature: number;
  userKey?: OpenaiAccountType;
  thinking?: { type: "enabled" | "disabled" };
  getContextMessages: () => ChatCompletionMessageParam[];
  getDelegatableTools: () => AgentToolDefinition[];
};

type AgentTask = {
  id: string;
  name?: string;
  status: AgentStatus;
  messages: ChatCompletionMessageParam[];
  queue: string[];
  currentAbort?: AbortController;
  pump?: Promise<void>;
  model: string;
  turns: number;
  lastOutput?: string;
  error?: string;
  updatedAt: number;
  isolation: AgentIsolation;
  cwd?: string;
  worktreePath?: string;
  worktreeRoot?: string;
  requiredMcpServers?: string[];
  outputFile?: string;
};

type SessionState = {
  agents: Map<string, AgentTask>;
  nameToId: Map<string, string>;
  hydratedFromDisk: boolean;
};

export type AgentSnapshot = {
  id: string;
  name?: string;
  status: AgentStatus;
  turns: number;
  queueLength: number;
  lastOutput?: string;
  error?: string;
  updatedAt: number;
  isolation: AgentIsolation;
  cwd?: string;
  worktreePath?: string;
  requiredMcpServers?: string[];
  outputFile?: string;
};

const sessions = new Map<string, SessionState>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const AGENT_OUTPUT_BASE = path.join(os.tmpdir(), "aistudio-agent-runs");
const RECOVERED_RUNNING_ERROR = "Recovered running subagent from previous process. Please rerun the task.";

const newAgentId = () =>
  `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const toToolSchema = (tool: AgentToolDefinition): ChatCompletionTool => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
});

const getOrCreateSession = (sessionId: string): SessionState => {
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const sessionFile = path.join(AGENT_OUTPUT_BASE, sessionId, "session.json");
  const created: SessionState = {
    agents: new Map(),
    nameToId: new Map(),
    hydratedFromDisk: false,
  };
  if (existsSync(sessionFile)) {
    try {
      const parsed = JSON.parse(readFileSync(sessionFile, "utf8")) as {
        agents?: Array<Partial<AgentTask>>;
      };
      const list = Array.isArray(parsed.agents) ? parsed.agents : [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        if (typeof item.id !== "string" || !item.id) continue;
        const restored: AgentTask = {
          id: item.id,
          name: typeof item.name === "string" ? item.name : undefined,
          status:
            item.status === "running" ||
            item.status === "completed" ||
            item.status === "failed" ||
            item.status === "closed"
              ? item.status
              : "completed",
          messages: [],
          queue: Array.isArray(item.queue) ? item.queue.filter((v): v is string => typeof v === "string") : [],
          model: typeof item.model === "string" ? item.model : "",
          turns: typeof item.turns === "number" ? item.turns : 0,
          lastOutput: typeof item.lastOutput === "string" ? item.lastOutput : undefined,
          error: typeof item.error === "string" ? item.error : undefined,
          updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
          isolation: item.isolation === "worktree" ? "worktree" : "session",
          cwd: typeof item.cwd === "string" ? item.cwd : undefined,
          worktreePath: typeof item.worktreePath === "string" ? item.worktreePath : undefined,
          worktreeRoot: typeof item.worktreeRoot === "string" ? item.worktreeRoot : undefined,
          requiredMcpServers: Array.isArray(item.requiredMcpServers)
            ? item.requiredMcpServers.filter((v): v is string => typeof v === "string")
            : undefined,
          outputFile: typeof item.outputFile === "string" ? item.outputFile : undefined,
        };
        if (restored.status === "running") {
          restored.status = "failed";
          restored.error = restored.error || RECOVERED_RUNNING_ERROR;
          restored.updatedAt = Date.now();
        }
        created.agents.set(restored.id, restored);
        if (restored.name) created.nameToId.set(restored.name, restored.id);
      }
      created.hydratedFromDisk = true;
    } catch {
      // ignore restore failures
    }
  }
  sessions.set(sessionId, created);
  return created;
};

const persistSessionState = (sessionId: string, session: SessionState) => {
  const file = path.join(AGENT_OUTPUT_BASE, sessionId, "session.json");
  const payload = {
    updatedAt: Date.now(),
    agents: [...session.agents.values()].map((task) => ({
      id: task.id,
      name: task.name,
      status: task.status,
      queue: task.queue,
      model: task.model,
      turns: task.turns,
      lastOutput: task.lastOutput,
      error: task.error,
      updatedAt: task.updatedAt,
      isolation: task.isolation,
      cwd: task.cwd,
      worktreePath: task.worktreePath,
      worktreeRoot: task.worktreeRoot,
      requiredMcpServers: task.requiredMcpServers,
      outputFile: task.outputFile,
    })),
  };
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // ignore persistence failures
  }
};

const toSnapshot = (task: AgentTask): AgentSnapshot => ({
  id: task.id,
  name: task.name,
  status: task.status,
  turns: task.turns,
  queueLength: task.queue.length,
  lastOutput: task.lastOutput,
  error: task.error,
  updatedAt: task.updatedAt,
  isolation: task.isolation,
  cwd: task.cwd,
  worktreePath: task.worktreePath,
  requiredMcpServers: task.requiredMcpServers,
  outputFile: task.outputFile,
});

const inferAvailableMcpServers = (tools: AgentToolDefinition[]) => {
  const servers = new Set<string>();
  for (const tool of tools) {
    const match = /^mcp__([^_]+(?:_[^_]+)*)__/.exec(tool.name);
    if (!match) continue;
    const raw = match[1];
    if (!raw) continue;
    servers.add(raw.replace(/_/g, "-"));
    servers.add(raw);
  }
  return servers;
};

const normalizeServerName = (value: string) => value.trim().toLowerCase().replace(/_/g, "-");

const normalizeRequiredMcpServers = (input?: string[]) =>
  (Array.isArray(input) ? input : [])
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);

const assertRequiredMcpServers = async (
  runtime: AgentRuntimeOptions,
  required: string[],
  timeoutMs = 30_000
) => {
  if (required.length === 0) return;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const connectedByStatus = new Set(
      getMcpServerStatuses()
        .filter((item) => item.connected)
        .map((item) => normalizeServerName(item.name))
    );
    const connectedByToolMap = new Set(
      getMcpServerToolMap()
        .filter((item) => Array.isArray(item.tools) && item.tools.length > 0)
        .map((item) => normalizeServerName(item.name))
    );
    const availableFromTools = inferAvailableMcpServers(runtime.getDelegatableTools());
    const hasExplicitStatus = connectedByStatus.size > 0 || connectedByToolMap.size > 0;
    const inferred = hasExplicitStatus
      ? new Set<string>()
      : new Set([...availableFromTools].map((item) => normalizeServerName(item)));
    const available = new Set([...connectedByStatus, ...connectedByToolMap, ...inferred]);
    const missing = required.filter((name) => !available.has(normalizeServerName(name)));
    if (missing.length === 0) return;
    await sleep(500);
  }
  const connectedByStatus = new Set(
    getMcpServerStatuses()
      .filter((item) => item.connected)
      .map((item) => normalizeServerName(item.name))
  );
  const connectedByToolMap = new Set(
    getMcpServerToolMap()
      .filter((item) => Array.isArray(item.tools) && item.tools.length > 0)
      .map((item) => normalizeServerName(item.name))
  );
  const availableFromTools = inferAvailableMcpServers(runtime.getDelegatableTools());
  const hasExplicitStatus = connectedByStatus.size > 0 || connectedByToolMap.size > 0;
  const inferred = hasExplicitStatus
    ? new Set<string>()
    : new Set([...availableFromTools].map((item) => normalizeServerName(item)));
  const available = new Set([...connectedByStatus, ...connectedByToolMap, ...inferred]);
  const missing = required.filter((name) => !available.has(normalizeServerName(name)));
  throw new Error(`Missing required MCP servers: ${missing.join(", ")}`);
};

const appendAgentOutput = async (task: AgentTask, line: string) => {
  if (!task.outputFile) return;
  const parent = path.dirname(task.outputFile);
  await fs.mkdir(parent, { recursive: true }).catch(() => undefined);
  await fs.appendFile(task.outputFile, `${line}\n`, "utf8").catch(() => undefined);
};

const trySetupWorktree = async (agentId: string, cwd?: string) => {
  const requestedCwd = (cwd || "").trim() || process.cwd();
  const { stdout } = await execFileAsync("git", ["-C", requestedCwd, "rev-parse", "--show-toplevel"]);
  const gitRoot = stdout.trim();
  if (!gitRoot) throw new Error("worktree isolation requires a git repository cwd");
  const worktreeBase = path.join(os.tmpdir(), "aistudio-agent-worktrees");
  mkdirSync(worktreeBase, { recursive: true });
  const worktreePath = path.join(worktreeBase, agentId);
  await execFileAsync("git", ["-C", gitRoot, "worktree", "add", "--detach", worktreePath]);
  return {
    worktreeRoot: gitRoot,
    worktreePath,
  };
};

const tryCleanupWorktree = async (task: AgentTask) => {
  if (!task.worktreePath || !task.worktreeRoot) return;
  try {
    await execFileAsync("git", [
      "-C",
      task.worktreeRoot,
      "worktree",
      "remove",
      "--force",
      task.worktreePath,
    ]);
  } catch {
    // ignore cleanup failures
  }
};

const resolveAgent = (session: SessionState, target: string): AgentTask | null => {
  const normalized = (target || "").trim();
  if (!normalized) return null;
  const byId = session.agents.get(normalized);
  if (byId) return byId;
  const mappedId = session.nameToId.get(normalized);
  if (!mappedId) return null;
  return session.agents.get(mappedId) || null;
};

const ensurePump = (task: AgentTask, runtime: AgentRuntimeOptions) => {
  if (task.pump) return;
  task.pump = (async () => {
    while (task.queue.length > 0) {
      const nextPrompt = task.queue.shift() || "";
      if (!nextPrompt.trim()) continue;
      task.status = "running";
      task.updatedAt = Date.now();
      const abortController = new AbortController();
      task.currentAbort = abortController;
      void appendAgentOutput(task, `[${new Date().toISOString()}] running prompt: ${nextPrompt.slice(0, 200)}`);
      try {
        const allTools = runtime.getDelegatableTools();
        const tools = allTools.map(toToolSchema);
        const runResult = await runMasterSubAgentRuntime({
          sessionId: runtime.sessionId,
          selectedModel: task.model || runtime.selectedModel,
          stream: false,
          recursionLimit: runtime.recursionLimit,
          temperature: runtime.temperature,
          userKey: runtime.userKey,
          thinking: runtime.thinking,
          toolChoice: "auto",
          messages: [
            ...task.messages,
            {
              role: "user",
              content: nextPrompt,
            } as ChatCompletionMessageParam,
          ],
          allTools,
          tools,
          abortSignal: abortController.signal,
        });
        task.messages = runResult.runResult.completeMessages;
        task.lastOutput = runResult.finalMessage;
        task.error = undefined;
        task.turns += 1;
        task.status = "completed";
        task.updatedAt = Date.now();
        persistSessionState(runtime.sessionId, getOrCreateSession(runtime.sessionId));
        void appendAgentOutput(task, `[${new Date().toISOString()}] completed: ${task.lastOutput || ""}`);
      } catch (error) {
        if (abortController.signal.aborted) {
          task.status = task.queue.length > 0 ? "running" : "completed";
          task.updatedAt = Date.now();
          persistSessionState(runtime.sessionId, getOrCreateSession(runtime.sessionId));
          void appendAgentOutput(task, `[${new Date().toISOString()}] interrupted`);
          continue;
        }
        task.status = "failed";
        task.error = error instanceof Error ? error.message : String(error ?? "unknown error");
        task.updatedAt = Date.now();
        persistSessionState(runtime.sessionId, getOrCreateSession(runtime.sessionId));
        void appendAgentOutput(task, `[${new Date().toISOString()}] failed: ${task.error}`);
        break;
      } finally {
        task.currentAbort = undefined;
      }
    }
  })().finally(() => {
    task.pump = undefined;
    task.updatedAt = Date.now();
    persistSessionState(runtime.sessionId, getOrCreateSession(runtime.sessionId));
    if (task.status === "completed" || task.status === "failed") {
      void runSubagentHooks({
        event: "SubagentStop",
        sessionId: runtime.sessionId,
        agentId: task.id,
        agentName: task.name,
        status: task.status,
      });
    }
  });
};

export const spawnSubAgent = async (
  runtime: AgentRuntimeOptions,
  input: SpawnAgentInput
): Promise<AgentSnapshot> => {
  const session = getOrCreateSession(runtime.sessionId);
  const requiredMcpServers = normalizeRequiredMcpServers(input.requiredMcpServers);
  await assertRequiredMcpServers(runtime, requiredMcpServers);
  const name = (input.name || "").trim() || undefined;
  if (name && session.nameToId.has(name)) {
    const existed = resolveAgent(session, name);
    if (existed && existed.status !== "closed") {
      throw new Error(`Agent name already exists: ${name}`);
    }
  }

  const id = newAgentId();
  const task: AgentTask = {
    id,
    name,
    status: "running",
    messages: input.forkContext === false ? [] : [...runtime.getContextMessages()],
    queue: [input.prompt],
    model: (input.model || "").trim() || runtime.selectedModel,
    turns: 0,
    updatedAt: Date.now(),
    isolation: input.isolation || "session",
    cwd: input.cwd,
    requiredMcpServers,
    outputFile: path.join(AGENT_OUTPUT_BASE, runtime.sessionId, `${id}.log`),
  };
  session.agents.set(id, task);
  if (name) session.nameToId.set(name, id);
  persistSessionState(runtime.sessionId, session);
  void runSubagentHooks({
    event: "SubagentStart",
    sessionId: runtime.sessionId,
    agentId: id,
    agentName: name,
    status: task.status,
  });
  const runInBackground = input.runInBackground !== false;
  if (task.isolation === "worktree") {
    const runWithWorktree = async () => {
      try {
        const setup = await trySetupWorktree(id, input.cwd);
        task.worktreeRoot = setup.worktreeRoot;
        task.worktreePath = setup.worktreePath;
        task.cwd = setup.worktreePath;
        task.updatedAt = Date.now();
      } catch (error) {
        task.status = "failed";
        task.error = error instanceof Error ? error.message : String(error ?? "worktree setup failed");
        task.updatedAt = Date.now();
      } finally {
        if (task.status !== "failed") {
          ensurePump(task, runtime);
        }
      }
    };
    if (runInBackground) {
      void runWithWorktree();
      return toSnapshot(task);
    }
    await runWithWorktree();
    if (task.pump) {
      await task.pump;
    }
    return toSnapshot(task);
  }
  ensurePump(task, runtime);
  if (!runInBackground && task.pump) {
    await task.pump;
  }
  return toSnapshot(task);
};

export const sendSubAgentInput = (
  runtime: AgentRuntimeOptions,
  input: SendAgentInput
): AgentSnapshot => {
  const session = getOrCreateSession(runtime.sessionId);
  const task = resolveAgent(session, input.target);
  if (!task) throw new Error(`Agent not found: ${input.target}`);
  if (task.status === "closed") throw new Error(`Agent is closed: ${input.target}`);

  if (input.interrupt && task.currentAbort) {
    task.currentAbort.abort();
  }
  task.queue.push(input.message);
  task.status = "running";
  task.updatedAt = Date.now();
  ensurePump(task, runtime);
  persistSessionState(runtime.sessionId, session);
  return toSnapshot(task);
};

export const waitSubAgent = async (
  runtime: AgentRuntimeOptions,
  input: WaitAgentInput
): Promise<AgentSnapshot & { timedOut?: boolean }> => {
  const timeoutMs = Math.max(1000, Math.min(input.timeoutMs || 30000, 300000));
  const session = getOrCreateSession(runtime.sessionId);
  const task = resolveAgent(session, input.target);
  if (!task) throw new Error(`Agent not found: ${input.target}`);

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const isIdle = !task.pump && !task.currentAbort && task.queue.length === 0;
    if (task.status === "failed" || task.status === "closed" || isIdle) {
      if (isIdle && task.status === "running") {
        task.status = "completed";
      }
      return toSnapshot(task);
    }
    await sleep(120);
  }
  return { ...toSnapshot(task), timedOut: true };
};

export const closeSubAgent = (runtime: AgentRuntimeOptions, input: CloseAgentInput): AgentSnapshot => {
  const session = getOrCreateSession(runtime.sessionId);
  const task = resolveAgent(session, input.target);
  if (!task) throw new Error(`Agent not found: ${input.target}`);
  if (task.currentAbort) {
    task.currentAbort.abort();
  }
  task.queue = [];
  task.status = "closed";
  task.updatedAt = Date.now();
  void tryCleanupWorktree(task);
  void runSubagentHooks({
    event: "SubagentStop",
    sessionId: runtime.sessionId,
    agentId: task.id,
    agentName: task.name,
    status: task.status,
  });
  persistSessionState(runtime.sessionId, session);
  return toSnapshot(task);
};

export const resumeSubAgent = (runtime: AgentRuntimeOptions, input: CloseAgentInput): AgentSnapshot => {
  const session = getOrCreateSession(runtime.sessionId);
  const task = resolveAgent(session, input.target);
  if (!task) throw new Error(`Agent not found: ${input.target}`);
  if (task.status === "closed") {
    task.status = "completed";
  }
  task.updatedAt = Date.now();
  persistSessionState(runtime.sessionId, session);
  return toSnapshot(task);
};

export const listSubAgents = (runtime: AgentRuntimeOptions): AgentSnapshot[] => {
  const session = getOrCreateSession(runtime.sessionId);
  return [...session.agents.values()]
    .map(toSnapshot)
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

export const getSubAgentResult = async (
  runtime: AgentRuntimeOptions,
  input: { target: string; maxChars?: number }
): Promise<AgentSnapshot & { outputTail?: string }> => {
  const session = getOrCreateSession(runtime.sessionId);
  const task = resolveAgent(session, input.target);
  if (!task) throw new Error(`Agent not found: ${input.target}`);
  const snapshot = toSnapshot(task);
  if (!task.outputFile) return snapshot;
  const maxChars = Math.max(200, Math.min(input.maxChars || 8000, 200000));
  const content = await fs.readFile(task.outputFile, "utf8").catch(() => "");
  const outputTail =
    content.length > maxChars ? `${content.slice(content.length - maxChars)}` : content;
  return {
    ...snapshot,
    outputTail,
  };
};

export const SUB_AGENT_TOOL_NAMES = new Set([
  "spawn_agent",
  "send_input",
  "send_message",
  "wait_agent",
  "close_agent",
  "resume_agent",
  "list_agents",
  "get_agent_result",
]);
