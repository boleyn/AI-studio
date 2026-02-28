import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "@aistudio/ai/compat/global/core/ai/type";
import { runAgentCall } from "@aistudio/ai/llm/agentCall";
import type { AgentToolDefinition } from "@server/agent/tools/types";
import type { SseEventName } from "@shared/network/sseEvents";
import { SseResponseEventEnum } from "@shared/network/sseEvents";

export interface SimpleWorkflowNodeResponse {
  nodeId: string;
  moduleName: string;
  moduleType: "tool";
  runningTime: number;
  status: "success" | "error";
  toolInput: unknown;
  toolRes: unknown;
}

interface RunSimpleAgentWorkflowInput {
  selectedModel: string;
  stream: boolean;
  recursionLimit: number;
  temperature: number;
  toolChoice?: "auto" | "required";
  messages: ChatCompletionMessageParam[];
  allTools: AgentToolDefinition[];
  tools: ChatCompletionTool[];
  abortSignal?: AbortSignal;
  onEvent?: (event: SseEventName, data: Record<string, unknown>) => void;
}

interface RunSimpleAgentWorkflowResult {
  runResult: Awaited<ReturnType<typeof runAgentCall>>;
  finalMessage: string;
  finalReasoning: string;
  flowResponses: SimpleWorkflowNodeResponse[];
}

const toSafeToolArgs = (raw: string | undefined): unknown => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const formatToolArgs = (raw: string | undefined): string => {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

const parseToolResponse = (response: string): unknown => {
  try {
    return JSON.parse(response);
  } catch {
    return response;
  }
};

export const runSimpleAgentWorkflow = async ({
  selectedModel,
  stream,
  recursionLimit,
  temperature,
  toolChoice,
  messages,
  allTools,
  tools,
  abortSignal,
  onEvent,
}: RunSimpleAgentWorkflowInput): Promise<RunSimpleAgentWorkflowResult> => {
  const flowResponses: SimpleWorkflowNodeResponse[] = [];

  const runResult = await runAgentCall({
    maxRunAgentTimes: recursionLimit,
    body: {
      model: selectedModel,
      messages,
      max_tokens: undefined,
      tools,
      temperature,
      stream,
      useVision: true,
      requestOrigin: process.env.STORAGE_EXTERNAL_ENDPOINT || "http://127.0.0.1:3000",
      tool_choice: toolChoice,
      toolCallMode: "toolChoice",
    },
    isAborted: () => abortSignal?.aborted,
    handleInteractiveTool: async () => ({
      response: "",
      assistantMessages: [],
      usages: [],
      stop: true,
    }),
    onStreaming: ({ text }) => {
      if (!text) return;
      onEvent?.(SseResponseEventEnum.answer, { text });
    },
    onReasoning: ({ text }) => {
      if (!text) return;
      onEvent?.(SseResponseEventEnum.reasoning, { text });
    },
    onToolCall: ({ call }) => {
      onEvent?.(SseResponseEventEnum.toolCall, {
        id: call.id,
        toolName: call.function?.name,
      });
    },
    onToolParam: ({ tool, params }) => {
      onEvent?.(SseResponseEventEnum.toolParams, {
        id: tool.id,
        toolName: tool.function?.name,
        params,
      });
    },
    handleToolResponse: async ({ call }) => {
      if (abortSignal?.aborted) {
        return {
          response: "stopped",
          assistantMessages: [],
          usages: [],
          stop: true,
        };
      }

      const startAt = Date.now();
      const tool = allTools.find((item) => item.name === call.function.name);
      let response = "";
      let status: "success" | "error" = "success";

      if (!tool) {
        status = "error";
        response = `未找到工具: ${call.function.name}`;
      } else {
        try {
          const parsed = toSafeToolArgs(call.function.arguments);
          const result = await tool.run(parsed);
          response = typeof result === "string" ? result : JSON.stringify(result);
        } catch (error) {
          status = "error";
          response = error instanceof Error ? error.message : "工具执行失败";
        }
      }

      const toolName = call.function.name;
      const params = formatToolArgs(call.function.arguments);
      const runningTime = Number(((Date.now() - startAt) / 1000).toFixed(2));

      onEvent?.(SseResponseEventEnum.toolResponse, {
        id: call.id,
        toolName,
        params,
        response,
      });

      const nodeResponse: SimpleWorkflowNodeResponse = {
        nodeId: `tool:${toolName}`,
        moduleName: toolName,
        moduleType: "tool",
        runningTime,
        status,
        toolInput: toSafeToolArgs(call.function.arguments),
        toolRes: parseToolResponse(response),
      };
      flowResponses.push(nodeResponse);

      onEvent?.(SseResponseEventEnum.flowNodeResponse, nodeResponse as unknown as Record<string, unknown>);

      const toolContent = JSON.stringify({
        toolName,
        params,
        response,
      });

      return {
        response: toolContent,
        assistantMessages: [
          {
            role: "tool",
            tool_call_id: call.id,
            name: toolName,
            content: toolContent,
          } as ChatCompletionMessageParam,
        ],
        usages: [],
      };
    },
  });

  const assistantMessage =
    [...runResult.assistantMessages].reverse().find((item) => item.role === "assistant") ||
    runResult.assistantMessages[runResult.assistantMessages.length - 1];

  const finalMessage = (() => {
    const content = assistantMessage?.content;
    if (typeof content === "string") return content;
    if (!content) return "";
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (!item || typeof item !== "object") return "";
          return "text" in item && typeof item.text === "string" ? item.text : "";
        })
        .join("");
    }
    return "";
  })();
  const finalReasoning = (() => {
    if (!assistantMessage || typeof assistantMessage !== "object") return "";
    const value = (assistantMessage as { reasoning_text?: unknown; reasoning_content?: unknown })
      .reasoning_text ??
      (assistantMessage as { reasoning_text?: unknown; reasoning_content?: unknown })
        .reasoning_content;
    return typeof value === "string" ? value : "";
  })();

  return {
    runResult,
    finalMessage: finalMessage || finalReasoning,
    finalReasoning,
    flowResponses,
  };
};
