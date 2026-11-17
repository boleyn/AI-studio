import path from "node:path";
import type { ChatCompletionMessageParam } from "@aistudio/ai/compat/global/core/ai/type";
import { createSdkMessage, type SdkMessage } from "@shared/chat/sdkMessages";
import type { SdkStreamEventName } from "@shared/network/sdkStreamEvents";
import { McpClientManager, loadMcpConfigsFromEnv } from "../mcp";
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
import { discoverWorkspaceSkills, registry } from "../tools";
import { getContextWindowForModel } from "./context";
import { runAgentLoop } from "./agentLoop";
import { createAgentModelClient, type AgentModelConnection } from "./modelClient";
import { getAgentRuntimeConfig } from "./config";
import { extractCurrentAttachments, extractSystemDirectives, toOpenAIHistory } from "./history";
import { buildSystemPrompt } from "./prompt";

export type RunHermesAgentInput = {
  token: string;
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
  connector?: { url: string; token?: string };
  onEvent: (event: SdkStreamEventName, data: Record<string, unknown>) => void;
};

export type RunHermesAgentResult = {
  assistantMessage: SdkMessage;
  updatedFiles?: Record<string, { code: string }>;
};

const comparableProjectContent = (code: string) =>
  code.replace(/^data:[^;,]*;base64,/i, "data:application/octet-stream;base64,");

const diffProjectFiles = (
  before: ProjectFiles | undefined,
  after: Record<string, { code: string }>,
  ignoredBaseline?: ProjectFiles,
): Record<string, { code: string }> => {
  const beforeMap = new Map<string, string>();
  for (const [rawPath, file] of Object.entries(before || {})) {
    beforeMap.set(normalizeVirtualPath(rawPath), comparableProjectContent(typeof file?.code === "string" ? file.code : ""));
  }
  const ignoredMap = new Map<string, string>();
  for (const [rawPath, file] of Object.entries(ignoredBaseline || {})) {
    ignoredMap.set(normalizeVirtualPath(rawPath), comparableProjectContent(typeof file?.code === "string" ? file.code : ""));
  }

  const changed: Record<string, { code: string }> = {};
  for (const [rawPath, file] of Object.entries(after)) {
    const normalizedPath = normalizeVirtualPath(rawPath);
    if (!isExportableProjectPath(normalizedPath) && !beforeMap.has(normalizedPath)) continue;
    if (beforeMap.get(normalizedPath) === comparableProjectContent(file.code)) continue;
    if (!beforeMap.has(normalizedPath) && ignoredMap.get(normalizedPath) === comparableProjectContent(file.code)) continue;
    changed[normalizedPath] = { code: file.code };
  }
  return changed;
};

export async function runHermesAgent(input: RunHermesAgentInput): Promise<RunHermesAgentResult> {
  if (input.abortSignal?.aborted) throw new Error("请求已取消");

  const config = getAgentRuntimeConfig();
  const model = (input.selectedModel || config.toolCallModel || config.normalModel || "").trim();
  if (!model) {
    throw new Error("未配置可用模型 (selectedModel / TOOL_CALL_MODEL)");
  }

  const permissionMode =
    typeof input.permissionMode === "string" && input.permissionMode.trim() ? input.permissionMode.trim() : "default";

  const systemSkillFiles = collectSystemSkillFiles(path.resolve(process.cwd(), "skills"));
  const runtimeSkillFiles = excludeProjectOverrides(systemSkillFiles, input.projectFiles);
  const inputProjectPaths = new Set(Object.keys(input.projectFiles || {}).map(normalizeVirtualPath));

  const sandbox = await createSandbox({
    workspaceKey: input.token || "project",
    kind: input.sandboxKind,
    projectFiles: input.projectFiles,
    runtimeFiles: runtimeSkillFiles,
    connector: input.connector,
  });

  const mcpManager = new McpClientManager();
  const runRegistry = registry.fork();
  const mcpConfigs = loadMcpConfigsFromEnv();
  if (mcpConfigs.length > 0) {
    await mcpManager.connectAll(mcpConfigs, runRegistry);
  }

  try {
    const [availableSkills, memoryBlock] = await Promise.all([
      discoverWorkspaceSkills(sandbox),
      input.token ? new MemoryStore(input.token).buildPromptBlock() : Promise.resolve(null),
    ]);
    const systemPrompt = buildSystemPrompt({
      sandboxKind: sandbox.kind,
      permissionMode,
      selectedSkills: input.selectedSkills,
      availableSkills,
      memoryBlock,
      systemDirectives: extractSystemDirectives(input.messages),
      currentAttachments: extractCurrentAttachments(input.messages),
      projectFilePaths: [...inputProjectPaths],
    });

    const openAIMessages = toOpenAIHistory(input.messages, input.historyMessages);
    const connection = input.modelConnection;
    const maxContext = connection?.maxContext && connection.maxContext > 0
      ? Math.floor(connection.maxContext)
      : getContextWindowForModel(model);
    const temperature = typeof connection?.maxTemperature === "number" && connection.maxTemperature >= 0
      ? Math.min(config.temperature, connection.maxTemperature)
      : config.temperature;

    const loopResult = await runAgentLoop({
      client: createAgentModelClient(model, maxContext, connection),
      model,
      temperature,
      maxContext,
      maxIterations: config.recursionLimit,
      systemPrompt,
      messages: openAIMessages,
      sandbox,
      registry: runRegistry,
      emit: (event, data) => input.onEvent(event, data),
      token: input.token,
      chatId: input.chatId,
      projectToken: input.token,
      permissionMode,
      inputProjectPaths,
      signal: input.abortSignal,
    });

    await sandbox.persist();

    let updatedFiles: Record<string, { code: string }> | undefined;
    if (input.projectFiles) {
      const snapshot = await sandbox.exportProjectFiles();
      const diff = diffProjectFiles(input.projectFiles, snapshot, systemSkillFiles);
      if (Object.keys(diff).length > 0) {
        updatedFiles = diff;
        input.onEvent("stream_event", { subtype: "files_updated", files: updatedFiles });
      }
    }

    const content =
      loopResult.assistantBlocks.length > 0
        ? loopResult.assistantBlocks
        : loopResult.assistantText || "";

    const assistantMessage = createSdkMessage({
      type: "assistant",
      message: {
        role: "assistant",
        content,
        model,
        maxContext,
        runUsage: loopResult.runUsage,
        ...(loopResult.usage ? { usage: loopResult.usage } : {}),
      } as any,
    });

    return { assistantMessage, updatedFiles };
  } finally {
    await mcpManager.closeAll();
    await sandbox.dispose();
  }
}

export { getAgentRuntimeConfig, getOpenAIClient, clearOpenAIClientCache, type AgentRuntimeConfig } from "./config";
export { getContextWindowForModel, toTokenBudget, MODEL_CONTEXT_WINDOW_DEFAULT } from "./context";
