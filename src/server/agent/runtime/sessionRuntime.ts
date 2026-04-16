import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "@aistudio/ai/compat/global/core/ai/type";
import { runAgentCall } from "@aistudio/ai/llm/agentCall";
import type { OpenaiAccountType } from "@aistudio/ai/compat/global/support/user/team/type";
import type { AgentToolDefinition } from "@server/agent/tools/types";
import {
  runPostToolUseHooks,
  runPostToolUseHooksWithResult,
  runPreToolUseHooks,
} from "@server/agent/hooks/runner";
import {
  createSdkMessage,
  type SdkContentBlock,
  type SdkMessage,
} from "@shared/chat/sdkMessages";
import { SdkStreamEventEnum, type SdkStreamEventName } from "@shared/network/sdkStreamEvents";
import { isPlanInteractionEnvelope } from "@shared/chat/planInteraction";

type SessionRuntimeInput = {
  sessionId?: string;
  selectedModel: string;
  stream: boolean;
  recursionLimit?: number;
  temperature: number;
  userKey?: OpenaiAccountType;
  thinking?: { type: "enabled" | "disabled" };
  toolChoice?: "auto" | "required";
  messages: ChatCompletionMessageParam[];
  allTools: AgentToolDefinition[];
  tools: ChatCompletionTool[];
  abortSignal?: AbortSignal;
  onEvent?: (event: SdkStreamEventName, data: Record<string, unknown>) => void;
};

type SessionRuntimeResult = {
  runResult: Awaited<ReturnType<typeof runAgentCall>>;
  assistantMessage: SdkMessage;
};

const toObject = (input: string | undefined): Record<string, unknown> => {
  if (!input) return {};
  try {
    const value = JSON.parse(input);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const stringifySafe = (value: unknown): string => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
};

const asText = (value: unknown): string => (typeof value === "string" ? value : "");

export const runSessionRuntime = async ({
  sessionId,
  selectedModel,
  stream,
  recursionLimit,
  temperature,
  userKey,
  thinking,
  toolChoice,
  messages,
  allTools,
  tools,
  abortSignal,
  onEvent,
}: SessionRuntimeInput): Promise<SessionRuntimeResult> => {
  const contentBlocks: SdkContentBlock[] = [];
  const pendingToolCalls = new Map<string, { name: string; input?: Record<string, unknown> }>();

  const emitStatus = (payload: Record<string, unknown>) => {
    onEvent?.(SdkStreamEventEnum.status, payload);
  };

  const runResult = await runAgentCall({
    maxRunAgentTimes: recursionLimit,
    body: {
      model: selectedModel,
      messages,
      max_tokens: undefined,
      tools,
      temperature,
      stream,
      useVision: false,
      requestOrigin: process.env.STORAGE_EXTERNAL_ENDPOINT || "http://127.0.0.1:3000",
      tool_choice: toolChoice,
      toolCallMode: "toolChoice",
      ...(thinking ? { thinking } : {}),
    },
    userKey,
    isAborted: () => abortSignal?.aborted,
    handleInteractiveTool: async () => ({
      response: "",
      assistantMessages: [],
      usages: [],
      stop: true,
    }),
    onStreaming: ({ text }) => {
      if (!text) return;
      onEvent?.(SdkStreamEventEnum.streamEvent, { subtype: "text_delta", text });
      contentBlocks.push({ type: "text", text });
    },
    onReasoning: ({ text }) => {
      if (!text) return;
      onEvent?.(SdkStreamEventEnum.streamEvent, { subtype: "thinking_delta", text });
      contentBlocks.push({ type: "thinking", thinking: text });
    },
    onToolCall: ({ call }) => {
      const toolId = asText(call?.id);
      const toolName = asText(call?.function?.name);
      if (!toolId || !toolName) return;
      pendingToolCalls.set(toolId, { name: toolName });
      onEvent?.(SdkStreamEventEnum.streamEvent, {
        subtype: "tool_use_start",
        id: toolId,
        name: toolName,
      });
      contentBlocks.push({
        type: "tool_use",
        id: toolId,
        name: toolName,
      });
    },
    onToolParam: ({ tool, params }) => {
      const toolId = asText(tool?.id);
      const toolName = asText(tool?.function?.name);
      if (!toolId || !toolName || !params) return;
      const parsedInput = toObject(params);
      pendingToolCalls.set(toolId, { name: toolName, input: parsedInput });
      onEvent?.(SdkStreamEventEnum.streamEvent, {
        subtype: "tool_use_delta",
        id: toolId,
        name: toolName,
        input: parsedInput,
      });
    },
    handleToolResponse: async ({ call }) => {
      const toolId = asText(call?.id);
      const toolName = asText(call?.function?.name);
      const tool = allTools.find((item) => item.name === toolName);
      const toolInput = toObject(call?.function?.arguments);
      const startedAt = Date.now();

      emitStatus({
        phase: "tool_in_progress",
        toolName,
        toolUseId: toolId,
      });

      let toolOutput = "";
      let toolError = false;

      if (!tool) {
        toolError = true;
        toolOutput = `Tool not found: ${toolName}`;
      } else {
        try {
          let nextInput: unknown = toolInput;
          const preHook = await runPreToolUseHooks({
            event: "PreToolUse",
            sessionId,
            toolName,
            toolInput: nextInput,
          });
          if (preHook.updatedInput !== undefined) {
            nextInput = preHook.updatedInput;
          }
          if (preHook.decision === "ask") {
            toolError = true;
            toolOutput = JSON.stringify({
              ok: false,
              requiresPermissionApproval: true,
              permission: {
                toolName,
                reason: preHook.reason || `Tool requires approval: ${toolName}`,
              },
            });
          } else if (preHook.decision === "block") {
            throw new Error(preHook.reason || `Blocked by PreToolUse hook: ${toolName}`);
          } else {
            const result = await tool.run(nextInput);
            const postHook = await runPostToolUseHooksWithResult({
              event: "PostToolUse",
              sessionId,
              toolName,
              toolInput: nextInput,
              toolResponse: result,
            });
            const finalResult =
              postHook.updatedToolOutput !== undefined ? postHook.updatedToolOutput : result;
            toolOutput = stringifySafe(finalResult);
          }
        } catch (error) {
          toolError = true;
          toolOutput = error instanceof Error ? error.message : "Tool execution failed";
          await runPostToolUseHooks({
            event: "PostToolUseFailure",
            sessionId,
            toolName,
            toolInput,
            error: toolOutput,
          });
        }
      }

      const interaction = (() => {
        try {
          const parsed = JSON.parse(toolOutput) as Record<string, unknown>;
          const value = parsed.interaction;
          return isPlanInteractionEnvelope(value) ? value : undefined;
        } catch {
          return undefined;
        }
      })();

      if (interaction) {
        onEvent?.(SdkStreamEventEnum.control, {
          kind: "plan_interaction",
          interaction,
        });
      }

      onEvent?.(SdkStreamEventEnum.streamEvent, {
        subtype: "tool_result",
        id: toolId,
        name: toolName,
        content: toolOutput,
        is_error: toolError,
      });

      contentBlocks.push({
        type: "tool_result",
        tool_use_id: toolId,
        content: toolOutput,
        ...(toolError ? { is_error: true } : {}),
      });

      emitStatus({
        phase: toolError ? "tool_error" : "tool_completed",
        toolName,
        toolUseId: toolId,
        elapsedMs: Date.now() - startedAt,
      });

      pendingToolCalls.delete(toolId);

      return {
        response: toolOutput,
        assistantMessages: [
          {
            role: "tool",
            tool_call_id: toolId,
            name: toolName,
            content: toolOutput,
          } as ChatCompletionMessageParam,
        ],
        usages: [],
        isError: toolError,
      };
    },
  });

  if (runResult.error) {
    const message =
      runResult.error instanceof Error
        ? runResult.error.message
        : stringifySafe(runResult.error);
    throw new Error(message || "session runtime failed");
  }

  const assistantMessage = createSdkMessage({
    type: "assistant",
    message: {
      role: "assistant",
      content: contentBlocks,
    },
  });

  onEvent?.(SdkStreamEventEnum.message, {
    message: assistantMessage,
  });

  onEvent?.(SdkStreamEventEnum.done, {
    reason: "completed",
  });

  return {
    runResult,
    assistantMessage,
  };
};
