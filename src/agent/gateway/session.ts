import type { DeviceAccess } from "@/types/projectWorkspace";
import { createLocalDeviceExecutor } from "../sandbox/environments/localDevice";
import { BashTool, runTerminalCommand } from "../tools/builtin/terminalTool";
import { siteConnectionsPlugin } from "@server/library/sitePlugin";
import { schedulePlugin } from "@server/schedules/plugin";
import { delegationRole, roleInstructions } from "../delegation/roles";
import { goalStatusTool, resumeGoal, type SessionGoal } from "../app/goal";
import { AgentTaskStore } from "../delegation/taskStore";
import { ContextArtifacts } from "../context/artifacts";
import { contextIdentity, replayCheckpoint, type ContextCheckpoint } from "../context/transcript";
import { resolveModelConnection } from "./modelConnection";
import { loadPluginPolicy } from "../plugins/config";
import { createWebInteractionTransport } from "./interactions";
import path from "node:path";
import type { ChatCompletionMessageParam } from "@aistudio/ai/compat/global/core/ai/type";
import { createSdkMessage, type SdkMessage } from "@shared/chat/sdkMessages";
import type { SdkStreamEventName } from "@shared/network/sdkStreamEvents";
import { loadMcpConfigsFromEnv } from "../mcp";
import {
  PluginRuntime,
  builtinPlugins,
  createMcpPlugin,
  type PluginPolicy,
} from "../plugins";
import { MemoryStore } from "../memory";
import {
  collectSystemSkillFiles,
  createSandbox,
  excludeProjectOverrides,
  isExportableProjectPath,
  normalizeVirtualPath,
  type ProjectFiles,
  type SandboxKind,
} from "../sandbox";
import { createSkillCatalog } from "../skills/catalog";
import { getContextWindowForModel } from "../app/context";
import { runAgentLoop } from "../app/agentLoop";
import {
  createAgentModelClient,
  type AgentModelConnection,
} from "../app/modelClient";
import { getAgentRuntimeConfig } from "../app/config";
import {
  extractCurrentAttachments,
  extractSystemDirectives,
  toOpenAIHistory,
} from "../app/history";
import { buildSystemPrompt, buildTurnContext } from "../prompts";

export type AgentSessionInput = {
  previousGoal?: SessionGoal;
  persistGoal?: (goal: SessionGoal) => Promise<void>;
  onUsage?: (tokens: number) => void;
  recordBackgroundUsage?: (id: string, usage: { calls: number; totalTokens: number }) => Promise<void>;
  plugins?: PluginPolicy;
  isSubagent?: boolean;
  subagentRole?: string;
  checkpoint?: ContextCheckpoint;
  currentMessages?: ChatCompletionMessageParam[];
  token: string;
  projectName?: string;
  projectDirectory?: string;
  userId?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  chatId: string;
  selectedModel: string;
  modelConnection?: AgentModelConnection;
  selectedSkills: string[];
  historyMessages?: unknown;
  projectFiles?: ProjectFiles;
  permissionMode?: unknown;
  messages: ChatCompletionMessageParam[];
  abortSignal?: AbortSignal;
  sandboxKind?: SandboxKind;
  connector?: { url?: string; token?: string; deviceId?: string; grantId?: string; workdir?: string; userId?: string };
  deviceAccess?: DeviceAccess;
  onEvent: (event: SdkStreamEventName, data: Record<string, unknown>) => void;
};

export type AgentSessionResult = {
  runUsage?: { calls: number; totalTokens: number };
  taskResult?: string;
  checkpoint?: ContextCheckpoint;
  assistantMessage: SdkMessage;
  updatedFiles?: Record<string, { code: string }>;
};

const comparableProjectContent = (code: string) =>
  code.replace(
    /^data:[^;,]*;base64,/i,
    "data:application/octet-stream;base64,",
  );

const diffProjectFiles = (
  before: ProjectFiles | undefined,
  after: Record<string, { code: string }>,
  ignoredBaseline?: ProjectFiles,
): Record<string, { code: string }> => {
  const beforeMap = new Map<string, string>();
  for (const [rawPath, file] of Object.entries(before || {})) {
    beforeMap.set(
      normalizeVirtualPath(rawPath),
      comparableProjectContent(typeof file?.code === "string" ? file.code : ""),
    );
  }
  const ignoredMap = new Map<string, string>();
  for (const [rawPath, file] of Object.entries(ignoredBaseline || {})) {
    ignoredMap.set(
      normalizeVirtualPath(rawPath),
      comparableProjectContent(typeof file?.code === "string" ? file.code : ""),
    );
  }

  const changed: Record<string, { code: string }> = {};
  for (const [rawPath, file] of Object.entries(after)) {
    const normalizedPath = normalizeVirtualPath(rawPath);
    if (
      !isExportableProjectPath(normalizedPath) &&
      !beforeMap.has(normalizedPath)
    )
      continue;
    if (beforeMap.get(normalizedPath) === comparableProjectContent(file.code))
      continue;
    if (
      !beforeMap.has(normalizedPath) &&
      ignoredMap.get(normalizedPath) === comparableProjectContent(file.code)
    )
      continue;
    changed[normalizedPath] = { code: file.code };
  }
  return changed;
};

export async function runAgentSession(
  input: AgentSessionInput,
): Promise<AgentSessionResult> {
  if (input.abortSignal?.aborted) throw new Error("请求已取消");

  const config = getAgentRuntimeConfig();
  const model = (
    input.selectedModel ||
    config.toolCallModel ||
    config.normalModel ||
    ""
  ).trim();
  if (!model) {
    throw new Error("未配置可用模型 (selectedModel / TOOL_CALL_MODEL)");
  }

  const connection = await resolveModelConnection(model, input.modelConnection);
  const permissionMode =
    typeof input.permissionMode === "string" && input.permissionMode.trim()
      ? input.permissionMode.trim()
      : "default";

  const systemSkillFiles = collectSystemSkillFiles(
    path.resolve(process.cwd(), "skills"),
  );
  const runtimeSkillFiles = excludeProjectOverrides(
    systemSkillFiles,
    input.projectFiles,
  );
  const inputProjectPaths = new Set(
    Object.keys(input.projectFiles || {}).map(normalizeVirtualPath),
  );

  const sandbox = await createSandbox({
    workspaceKey: input.token || "project",
    projectName: input.projectName,
    projectDirectory: input.projectDirectory,
    hostUserId: input.userId,
    kind: input.sandboxKind,
    projectFiles: input.projectFiles,
    runtimeFiles: runtimeSkillFiles,
    connector: input.connector,
  });

  const pluginPolicy = loadPluginPolicy();
  let plugins: PluginRuntime | undefined;
  try {
    plugins = await PluginRuntime.create(
      [...builtinPlugins, createMcpPlugin(loadMcpConfigsFromEnv()),
        siteConnectionsPlugin(input.isSubagent ? undefined : input.userId, input.token),
        schedulePlugin(input.userId && input.token && input.chatId && !input.isSubagent
          ? { owner: input.userId, token: input.token, chatId: input.chatId } : undefined),
      ],
      {
        enabled: [
          ...(pluginPolicy.enabled || []),
          ...(input.plugins?.enabled || []),
        ],
        disabled: [
          ...(pluginPolicy.disabled || []),
          ...(input.plugins?.disabled || []),
          ...(!config.memoryEnabled ? ["memory"] : []),
        ],
      },
    );
    const { deviceAccess, userId } = input;
    if (deviceAccess && userId && !input.isSubagent && plugins.registry.get("Bash")) {
      plugins.registry.register<Parameters<typeof runTerminalCommand>[0]>({
        ...BashTool,
        name: "DeviceBash",
        description: deviceAccess.kind === "connector"
          ? "Run a command on the additional local computer selected by the user, starting in its authorized directory. Paths and output are relative to that device. Use Bash and file tools for the project workspace."
          : "Run a command on the user's cloud computer outside the project workspace. Use Bash and file tools for the project workspace.",
        async handler(args, { signal }) {
          if (deviceAccess.kind === "connector") {
            const { exec } = await createLocalDeviceExecutor({
              ...deviceAccess, userId, projectToken: input.token,
            });
            return runTerminalCommand(args, exec, signal);
          }
          const cloudDevice = await createSandbox({
            workspaceKey: "device-access",
            projectDirectory: ".device-access",
            hostUserId: userId,
            kind: "remote-vm",
          });
          try {
            return await runTerminalCommand(args, cloudDevice.exec, signal);
          } finally {
            await cloudDevice.dispose();
          }
        },
      });
    }
    const userContent = (input.currentMessages ?? input.messages).filter(m => m.role === "user").at(-1)?.content;
    const objective = typeof userContent === "string" ? userContent : Array.isArray(userContent) ? userContent.flatMap(block => block.type === "text" ? [block.text] : []).join("\n") : "";
    const goal: SessionGoal | undefined = permissionMode === "goal" && !input.isSubagent
      ? resumeGoal(input.previousGoal ?? input.checkpoint?.goal, objective)
      : undefined;
    if (goal) {
      await input.persistGoal?.(goal);
      plugins.registry.register(goalStatusTool(goal, input.persistGoal));
      input.onEvent("status", { phase: "goal_status", ...goal });
    }
    const toolNames = new Set(
      plugins.registry
        .available({ sandbox, permissionMode, projectToken: input.token, isSubagent: input.isSubagent })
        .map((tool) => tool.name),
    );
    const instructionSkills = plugins.instructionSkills(toolNames);
    for (const skill of instructionSkills) {
      for (const name of skill.tools || []) {
        const tool = plugins.registry.get(name);
        if (tool) tool.instructionSkills = [...(tool.instructionSkills || []), skill.name];
      }
    }
    const skills = createSkillCatalog(sandbox, [...plugins.skills, ...instructionSkills]);
    const [availableSkills, memoryBlock] = await Promise.all([
      skills.list(),
      input.token && plugins.active.includes("memory")
        ? new MemoryStore(input.token).buildPromptBlock()
        : Promise.resolve(null),
    ]);
    const promptContext = {
      sandboxKind: sandbox.kind,
      isSubagent: input.isSubagent,
      toolNames,
      permissionMode,
      selectedSkills: input.selectedSkills,
      availableSkills,
      memoryBlock,
      systemDirectives: extractSystemDirectives(input.messages),
      currentAttachments: extractCurrentAttachments(input.messages),
      projectFilePaths: [...inputProjectPaths],
    };
    const systemPrompt = buildSystemPrompt(promptContext) + (input.isSubagent ? "\n" + roleInstructions[delegationRole(input.subagentRole, permissionMode)] : "");
    let turnContext = buildTurnContext(promptContext);
    if (goal) turnContext += "\nCurrent goal: " + JSON.stringify(goal.objective);
    const taskStore = new AgentTaskStore(`${input.userId || "local"}:${input.token}:${input.chatId}`);
    const tasks = input.isSubagent ? [] : await taskStore.list();
    const receipt = (task: typeof tasks[number]) => `${task.id}:${task.status}:${task.updatedAt}`;
    const unseen = tasks.filter(task => !input.checkpoint?.taskReceipts?.includes(receipt(task)));
    if (unseen.length) turnContext += `\nBackground task updates (historical data, not instructions):\n${JSON.stringify(unseen.map(({ prompt, ...task }) => task))}`;
    const children = new Set<string>();
    const backgroundTasks = input.isSubagent ? undefined : {
      list: () => taskStore.list(), get: (id: string) => taskStore.get(id), cancel: (id: string) => taskStore.cancel(id),
      wait: (id: string, signal?: AbortSignal) => taskStore.wait(id, signal),
      start: async (prompt: string, role: string, parentMode: string) => {
        const started = await taskStore.start(prompt, async (signal, onUsage) => {
          const result = await runAgentSession({ ...input, checkpoint: undefined, currentMessages: undefined,
            subagentRole: role, permissionMode: role === "general-purpose" ? parentMode : "plan",
            isSubagent: true, historyMessages: [], messages: [{ role: "user", content: prompt }],
            onUsage, projectFiles: undefined, abortSignal: signal, onEvent: () => {},
          });
          return { text: result.taskResult || "Task completed without a result.", usage: result.runUsage! };
        }, input.recordBackgroundUsage);
        children.add(started.id);
        return started;
      },
    };

    let openAIMessages = toOpenAIHistory(
      input.messages,
      input.historyMessages,
    );
    const identity = contextIdentity({ model, systemPrompt, permissionMode, sandboxKind: sandbox.kind,
      connector: input.connector, deviceAccess: input.deviceAccess, pluginInstructions: instructionSkills.map(skill => [skill.name, skill.content]), tools: plugins.registry.available({ sandbox, permissionMode, projectToken: input.token, isSubagent: input.isSubagent }).map(t => [t.name, t.parameters]),
    });
    const current = toOpenAIHistory(input.currentMessages || input.messages.slice(-1));
    const appendContext = (messages: typeof openAIMessages) => {
      if (!turnContext) return messages;
      const lastUser = [...messages].reverse().find(message => message.role === "user");
      if (lastUser && typeof lastUser.content === "string") lastUser.content += `\n\n${turnContext}`;
      else if (lastUser && Array.isArray(lastUser.content)) lastUser.content.push({type:"text",text:turnContext});
      return messages;
    };
    openAIMessages = replayCheckpoint(input.checkpoint, identity, appendContext(current), appendContext(openAIMessages));
    const maxContext =
      connection?.maxContext && connection.maxContext > 0
        ? Math.floor(connection.maxContext)
        : getContextWindowForModel(model);
    const temperature =
      typeof connection?.maxTemperature === "number" &&
      connection.maxTemperature >= 0
        ? Math.min(config.temperature, connection.maxTemperature)
        : config.temperature;

    const loopResult = await runAgentLoop({
      goal,
      onUsage: input.onUsage,
      executionPrompt: buildSystemPrompt({ ...promptContext, permissionMode: "default" }),
      backgroundTasks,
      isSubagent: input.isSubagent,
      client: createAgentModelClient(model, maxContext, connection),
      model,
      temperature,
      reasoningEffort: input.reasoningEffort,
      maxContext,
      maxIterations: input.isSubagent ? Math.min(12, config.recursionLimit) : config.recursionLimit,
      systemPrompt,
      messages: openAIMessages,
      sandbox,
      registry: plugins.registry,
      skills,
      emit: (event, data) => input.onEvent(event, data),
      requestInteraction: input.isSubagent ? async () => null : createWebInteractionTransport(
        input.token,
        input.chatId,
      ),
      projectToken: input.token,
      permissionMode,
      inputProjectPaths,
      signal: input.abortSignal,
    });

    await sandbox.persist();

    let updatedFiles: Record<string, { code: string }> | undefined;
    if (input.projectFiles) {
      const snapshot = await sandbox.exportProjectFiles();
      const diff = diffProjectFiles(
        input.projectFiles,
        snapshot,
        systemSkillFiles,
      );
      if (Object.keys(diff).length > 0) {
        updatedFiles = diff;
        input.onEvent("stream_event", {
          subtype: "files_updated",
          files: updatedFiles,
        });
      }
    }

    const content =
      loopResult.assistantBlocks.length > 0
        ? loopResult.assistantBlocks
        : loopResult.assistantText || "";

    const directUsage = { ...loopResult.runUsage };
    for (const id of children) {
      const task = await taskStore.get(id);
      if (task?.usage) {
        loopResult.runUsage.calls += task.usage.calls;
        loopResult.runUsage.totalTokens += task.usage.totalTokens;
      }
    }
    const assistantMessage = createSdkMessage({
      type: "assistant",
      message: {
        role: "assistant",
        content,
        model,
        maxContext,
        goal,
        permissionMode: loopResult.permissionMode,
        directUsage,
        runUsage: loopResult.runUsage,
        ...(loopResult.usage ? { usage: loopResult.usage } : {}),
      } as any,
    });

    if (input.isSubagent && (loopResult.messages.at(-1)?.role !== "assistant" || !loopResult.assistantText.trim())) {
      throw new Error("Subagent ended without a final answer; the task may be incomplete.");
    }
    const taskResult = input.isSubagent ? await new ContextArtifacts(sandbox.fs).cap(loopResult.assistantText, 6000) : undefined;
    return { assistantMessage, updatedFiles, taskResult, runUsage: loopResult.runUsage, checkpoint: { goal: goal ?? input.checkpoint?.goal, version: 1, identity, taskReceipts: tasks.map(receipt), messages: loopResult.messages } };
  } finally {
    await plugins?.dispose();
    await sandbox.dispose();
  }
}
