import { contextLimits } from "../context/budget";
import { ContextArtifacts } from "../context/artifacts";
import { createToolDisclosure } from "../tools/disclosure";
import { encodeProjectFile } from "../sandbox/paths";
import { randomUUID } from "node:crypto";
import type { AgentModelClient } from "./modelClient";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { SdkContentBlock } from "@shared/chat/sdkMessages";
import { isExportableProjectPath, normalizeVirtualPath, type Sandbox } from "../sandbox";
import type { InteractionDecision, InteractionKind, ToolEventEmitter, ToolRegistry } from "../tools";
import { getContextWindowForModel, toTokenBudget } from "./context";
import { compressContextIfNeeded } from "./compressor";
import { AgentSessionTracker } from "./session";

export type InteractionTransport = (request: {
  kind: InteractionKind;
  toolName: string;
  toolUseId: string;
  input: unknown;
  signal?: AbortSignal;
}) => Promise<InteractionDecision | null>;

export type AgentLoopInput = {
  backgroundTasks?: import("../tools/types").ToolContext["backgroundTasks"];
  client: AgentModelClient;
  model: string;
  temperature: number;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  maxContext?: number;
  maxIterations: number;
  systemPrompt: string;
  messages: ChatCompletionMessageParam[];
  sandbox: Sandbox;
  registry: ToolRegistry;
  skills?: import("../skills/catalog").SkillCatalog;
  emit: ToolEventEmitter;
  requestInteraction: InteractionTransport;
  projectToken?: string;
  permissionMode: string;
  inputProjectPaths: Set<string>;
  signal?: AbortSignal;
  isSubagent?: boolean;
  parentToolUseId?: string;
};

export type AgentLoopResult = {
  messages: ChatCompletionMessageParam[];
  assistantText: string;
  assistantBlocks: SdkContentBlock[];
  usage?: { input_tokens: number; output_tokens: number; cached_input_tokens?: number };
  runUsage: { calls: number; totalTokens: number };
  pendingInteraction: boolean;
  stopReason: string | null;
};

type AccumulatedToolCall = {
  id: string;
  name: string;
  arguments: string;
  started: boolean;
  lastParsedInput?: unknown;
};

const parseJsonLoose = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
};

const visibleCall = (name: string, args: unknown) => {
  if (name === "call_dynamic_tool" && args && typeof args === "object") {
    const input = args as { tool_name?: unknown; arguments?: unknown };
    if (typeof input.tool_name === "string") return { name: input.tool_name, input: input.arguments };
  }
  return { name, input: args };
};

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const maxContext = input.maxContext ?? getContextWindowForModel(input.model);
  const conversation: ChatCompletionMessageParam[] = [...input.messages];
  const assistantBlocks: SdkContentBlock[] = [];
  let finalText = "";
  let stopReason: string | null = null;
  let lastUsage: AgentLoopResult["usage"];
  const runUsage = { calls: 0, totalTokens: 0 };
  let pendingInteraction = false;
  let lastBudgetFingerprint = "";
  const session = new AgentSessionTracker();
  const artifacts = new ContextArtifacts(input.sandbox.fs);

  const disclosedTools = createToolDisclosure(input.registry, input);
  const openAITools = disclosedTools.toOpenAITools(disclosedTools.available(input));

  const emitBudget = (promptTokens: number, completionTokens: number) => {
    const tokenBudget = toTokenBudget({ promptTokens, completionTokens, model: input.model, maxContext });
    const fp = `${tokenBudget.usedTokens}:${tokenBudget.maxContext}`;
    if (fp === lastBudgetFingerprint) return;
    lastBudgetFingerprint = fp;
    input.emit("status", { text: "token_budget", tokenBudget });
  };

  for (let iteration = 0; iteration < input.maxIterations; iteration += 1) {
    if (input.signal?.aborted) throw new Error("请求已取消");
    session.iterations += 1;

    const trimmed = await compressContextIfNeeded({
      client: input.client,
      model: input.model,
      messages: conversation,
      maxContext,
      systemPrompt: input.systemPrompt,
      tools: openAITools,
      artifacts,
      signal: input.signal,
    });
    if (trimmed.compacted) {
      session.compactions += 1;
      conversation.splice(0, conversation.length, ...trimmed.messages);
      if (!input.isSubagent) {
        input.emit("stream_event", { subtype: "compact_boundary", trigger: "auto" });
      }
    }

    const requestMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: input.systemPrompt },
      ...trimmed.messages,
    ];

    const stream = await input.client.stream(
      {
        model: input.model,
        temperature: input.temperature,
        messages: requestMessages,
        ...(openAITools.length > 0 ? { tools: openAITools, tool_choice: "auto" } : {}),
        ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
        max_tokens: contextLimits(maxContext).output,
        stream: true,
        stream_options: { include_usage: true },
      } as Parameters<AgentModelClient["stream"]>[0],
      input.signal,
    );

    let turnText = "";
    let reasoningContent = "";
    let turnUsage: AgentLoopResult["usage"];
    let turnTotalTokens = 0;
    const toolCallsByIndex = new Map<number, AccumulatedToolCall>();

    for await (const chunk of stream) {
      if (input.signal?.aborted) throw new Error("请求已取消");

      if (chunk.usage) {
        const promptTokens = chunk.usage.prompt_tokens || 0;
        const completionTokens = chunk.usage.completion_tokens || 0;
        const providerUsage = chunk.usage as typeof chunk.usage & { prompt_cache_hit_tokens?: number };
        const cachedTokens = providerUsage.prompt_tokens_details?.cached_tokens ?? providerUsage.prompt_cache_hit_tokens;
        turnUsage = { input_tokens: promptTokens, output_tokens: completionTokens, ...(typeof cachedTokens === "number" ? { cached_input_tokens: cachedTokens } : {}) };
        session.recordUsage(promptTokens, completionTokens);
        if (!input.isSubagent) input.emit("status", { phase: "context_usage", inputTokens: promptTokens, outputTokens: completionTokens, ...(typeof cachedTokens === "number" ? { cachedInputTokens: cachedTokens } : {}), exposedToolCount: openAITools.length });
        turnTotalTokens = Math.max(promptTokens + completionTokens, chunk.usage.total_tokens || 0);
        if (!input.isSubagent) emitBudget(promptTokens, completionTokens);
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) stopReason = choice.finish_reason;

      const delta = choice.delta as {
        content?: string | null;
        reasoning_content?: string | null;
        reasoning?: string | null;
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };

      if (typeof delta.reasoning_content === "string") reasoningContent += delta.reasoning_content;
      const thinkingChunk = delta.reasoning_content || delta.reasoning;
      if (typeof thinkingChunk === "string" && thinkingChunk && !input.isSubagent) {
        input.emit("stream_event", { subtype: "thinking_delta", text: thinkingChunk });
      }

      if (typeof delta.content === "string" && delta.content) {
        turnText += delta.content;
        if (!input.isSubagent) {
          input.emit("stream_event", { subtype: "text_delta", text: delta.content });
        }
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = typeof tc.index === "number" ? tc.index : 0;
          let acc = toolCallsByIndex.get(idx);
          if (!acc) {
            acc = {
              id: tc.id || `call_${randomUUID().slice(0, 12)}`,
              name: tc.function?.name || "",
              arguments: "",
              started: false,
            };
            toolCallsByIndex.set(idx, acc);
          } else {
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
          }

          if (tc.function?.arguments) {
            acc.arguments += tc.function.arguments;
            const parsed = parseJsonLoose(acc.arguments);
            if (parsed !== undefined) acc.lastParsedInput = parsed;
          }

          const display = visibleCall(acc.name, acc.lastParsedInput);
          if (!acc.started && acc.name && (acc.name !== "call_dynamic_tool" || display.name !== acc.name)) {
            acc.started = true;
            input.emit("stream_event", {
              subtype: input.parentToolUseId ? "agent_tool_use_start" : "tool_use_start",
              id: acc.id,
              name: display.name,
              ...(display.input !== undefined ? { input: display.input } : {}),
              ...(input.parentToolUseId ? { parent_agent_tool_use_id: input.parentToolUseId } : {}),
            });
          } else if (acc.started && tc.function?.arguments) {
            input.emit("stream_event", {
              subtype: input.parentToolUseId ? "agent_tool_use_delta" : "tool_use_delta",
              id: acc.id,
              name: display.name,
              input: display.input ?? acc.arguments,
              ...(input.parentToolUseId ? { parent_agent_tool_use_id: input.parentToolUseId } : {}),
            });
          }
        }
      }
    }

    runUsage.calls += 1;
    if (turnUsage) {
      lastUsage = turnUsage;
      runUsage.totalTokens += turnTotalTokens;
    }

    if (turnText.trim()) {
      finalText = turnText;
      assistantBlocks.push({ type: "text", text: turnText });
    }

    const orderedCalls = [...toolCallsByIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call)
      .filter((call) => call.name);

    if (orderedCalls.length === 0) {
      if (turnText) conversation.push({ role: "assistant", content: turnText, ...(reasoningContent ? { reasoning_content: reasoningContent } : {}) });
      break;
    }

    conversation.push({
      role: "assistant",
      content: turnText || null,
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      tool_calls: orderedCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments || "{}" },
      })),
    });

    for (const call of orderedCalls) {
      const parsedInput = parseJsonLoose(call.arguments) ?? {};
      const display = visibleCall(call.name, parsedInput);
      assistantBlocks.push({
        type: "tool_use",
        id: call.id,
        name: display.name,
        input: (display.input && typeof display.input === "object" ? display.input : {}) as Record<string, unknown>,
      });

      const requestInteraction = (kind: InteractionKind, payload: unknown): Promise<InteractionDecision | null> => {
        pendingInteraction = true;
        return input.requestInteraction({
          kind, toolName: display.name, toolUseId: call.id, input: payload, signal: input.signal,
        });
      };

      const runSubagent = async (subParams: {
        toolUseId: string;
        prompt: string;
        description?: string;
        subagentType?: string;
        signal?: AbortSignal;
      }) => {
        const subResult = await runAgentLoop({
          ...input,
          systemPrompt: `${input.systemPrompt}\nRole: isolated subagent. Complete only the delegated task. Return concise findings, exact evidence paths and unresolved issues. Do not assume the parent conversation is available.`,
          maxContext: Math.min(maxContext, 64000),
          maxIterations: Math.min(12, input.maxIterations),
          messages: [{ role: "user", content: subParams.prompt }],
          isSubagent: true,
          parentToolUseId: subParams.toolUseId,
          signal: subParams.signal ?? input.signal,
        });
        runUsage.calls += subResult.runUsage.calls;
        runUsage.totalTokens += subResult.runUsage.totalTokens;
        return subResult.assistantText;
      };

      const toolStart = Date.now();
      const rawResult = await disclosedTools.dispatch(call.name, call.arguments || "{}", {
        sandbox: input.sandbox,
        backgroundTasks: input.backgroundTasks,
        skills: input.skills,
        toolUseId: call.id,
        signal: input.signal,
        emit: input.emit,
        requestInteraction,
        runSubagent,
        projectToken: input.projectToken,
        permissionMode: input.permissionMode,
        isSubagent: input.isSubagent,
      });
      const result = { ...rawResult, content: await artifacts.capToolObservation(rawResult.content) };
      session.recordToolCall(display.name, Date.now() - toolStart, Boolean(result.isError));

      input.emit("stream_event", {
        subtype: input.parentToolUseId ? "agent_tool_result" : "tool_result",
        id: call.id,
        name: display.name,
        ...(display.input !== undefined ? { input: display.input } : {}),
        ...(input.parentToolUseId ? { parent_agent_tool_use_id: input.parentToolUseId } : {}),
        content: result.content,
        ...(result.isError ? { is_error: true } : {}),
      });

      if (result.changedPaths && result.changedPaths.length > 0 && !input.isSubagent) {
        const updatedFiles: Record<string, { code: string }> = {};
        for (const changedPath of result.changedPaths) {
          const normalized = normalizeVirtualPath(changedPath);
          if (!isExportableProjectPath(normalized) && !input.inputProjectPaths.has(normalized)) continue;
          try {
            updatedFiles[normalized] = { code: encodeProjectFile(await input.sandbox.fs.readFile(normalized)) };
          } catch {
            // 忽略读取失败
          }
        }
        if (Object.keys(updatedFiles).length > 0) {
          input.emit("stream_event", { subtype: "files_updated", files: updatedFiles });
        }
      }

      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: result.content,
      });
    }
  }

  if (!input.isSubagent) {
    input.emit("status", { phase: "session_summary", ...session.toSummary() });
  }

  return {
    messages: conversation,
    assistantText: finalText,
    assistantBlocks,
    usage: lastUsage,
    runUsage,
    pendingInteraction,
    stopReason,
  };
}
