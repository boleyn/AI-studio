import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "@aistudio/ai/compat/global/core/ai/type";
import { runAgentCall } from "@aistudio/ai/llm/agentCall";
import type { OpenaiAccountType } from "@aistudio/ai/compat/global/support/user/team/type";
import type { AgentToolDefinition } from "@server/agent/tools/types";
import type { SseEventName } from "@shared/network/sseEvents";
import { SseResponseEventEnum } from "@shared/network/sseEvents";
import json5 from "json5";

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
  recursionLimit?: number;
  temperature: number;
  userKey?: OpenaiAccountType;
  thinking?: { type: "enabled" | "disabled" };
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

const parsePossiblyNestedJson = (raw: string | undefined): unknown => {
  if (!raw) return {};
  let current: unknown = raw;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "string") break;
    const trimmed = current.trim();
    if (!trimmed) break;
    try {
      current = JSON.parse(trimmed);
      continue;
    } catch {
      try {
        current = json5.parse(trimmed);
        continue;
      } catch {
        const objectStart = trimmed.indexOf("{");
        const objectEnd = trimmed.lastIndexOf("}");
        if (objectStart >= 0 && objectEnd > objectStart) {
          const candidate = trimmed.slice(objectStart, objectEnd + 1);
          try {
            current = JSON.parse(candidate);
            continue;
          } catch {
            try {
              current = json5.parse(candidate);
              continue;
            } catch {
              // keep raw string
            }
          }
        }
      }
      break;
    }
  }
  return current;
};

const coerceToolArgs = (raw: string | undefined): unknown => {
  const parsed = parsePossiblyNestedJson(raw);
  if (typeof parsed !== "string") return parsed;
  const trimmed = parsed.trim();
  if (!trimmed) return {};
  // If it still looks like a JSON-ish payload but parsing failed, fallback to empty object
  // to avoid passing malformed string into object-schema tools.
  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.includes(":") ||
    trimmed.includes("\"")
  ) {
    return {};
  }
  return parsed;
};

const toSafeToolArgs = (raw: string | undefined): unknown => coerceToolArgs(raw);

const toRawToolArgSnippet = (raw: string | undefined, maxChars = 240) => {
  const value = (raw || "").trim();
  if (!value) return "";
  return value.length > maxChars ? `${value.slice(0, maxChars)}...[truncated]` : value;
};

const inspectRawToolArgs = (raw: string | undefined) => {
  const trimmed = (raw || "").trim();
  const rawLength = trimmed.length;
  const rawTail = rawLength > 160 ? trimmed.slice(-160) : trimmed;
  const endsWithJsonCloser = /[}\]]\s*$/.test(trimmed);
  let jsonValid = false;
  if (trimmed) {
    try {
      JSON.parse(trimmed);
      jsonValid = true;
    } catch {
      jsonValid = false;
    }
  }
  const hasJsonOpen = trimmed.includes("{") || trimmed.includes("[");
  const likelyTruncated = Boolean(trimmed) && hasJsonOpen && !endsWithJsonCloser && !jsonValid;
  return {
    rawLength,
    rawTail,
    endsWithJsonCloser,
    jsonValid,
    likelyTruncated,
  };
};

const isValidWriteFileArgs = (input: unknown): input is { file_path: string; content: string } => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as { file_path?: unknown; content?: unknown };
  return typeof value.file_path === "string" && typeof value.content === "string";
};

const formatToolArgs = (raw: string | undefined): string => {
  if (!raw) return "";
  const parsed = parsePossiblyNestedJson(raw);
  if (typeof parsed === "string") return parsed;
  try {
    return JSON.stringify(parsed, null, 2);
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

const toDebugSnippet = (value: string, maxChars = 2000) =>
  value.length > maxChars ? `${value.slice(0, maxChars)}...[truncated ${value.length - maxChars} chars]` : value;

const mapToolResponseForModel = (toolName: string, response: string): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response);
  } catch {
    return response;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return response;
  }

  const payload = parsed as Record<string, unknown>;
  const action = typeof payload.action === "string" ? payload.action : "";
  const isFailure = payload.ok === false;

  const filePath = (() => {
    if (typeof payload.filePath === "string" && payload.filePath.trim()) return payload.filePath;
    if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
      const path = (payload.data as Record<string, unknown>).path;
      if (typeof path === "string" && path.trim()) return path;
    }
    return "";
  })();

  const resolveWriteMessage = () => {
    const type = typeof payload.type === "string" ? payload.type : "";
    if (type === "create" && filePath) return `File created successfully at: ${filePath}`;
    if (filePath) return `The file ${filePath} has been updated successfully.`;
    return "File updated successfully.";
  };

  const resolveEditMessage = () => {
    const replaceAll = Boolean(payload.replaceAll);
    const userModified = Boolean(payload.userModified);
    const modifiedNote = userModified
      ? ". The user modified your proposed changes before accepting them."
      : "";
    if (replaceAll && filePath) {
      return `The file ${filePath} has been updated${modifiedNote}. All occurrences were successfully replaced.`;
    }
    if (filePath) return `The file ${filePath} has been updated successfully${modifiedNote}.`;
    return `File updated successfully${modifiedNote}.`;
  };

  const resolveGlobMessage = () => {
    const files = Array.isArray(payload.filenames)
      ? payload.filenames.filter((item): item is string => typeof item === "string")
      : [];
    const truncated = Boolean(payload.truncated);
    if (files.length === 0) return "No files found";
    return [
      ...files,
      ...(truncated ? ["(Results are truncated. Consider using a more specific path or pattern.)"] : []),
    ].join("\n");
  };

  if (toolName === "Write" || (toolName === "global" && action === "write")) {
    if (isFailure) return response;
    return resolveWriteMessage();
  }

  if (toolName === "Edit" || (toolName === "global" && action === "replace")) {
    if (isFailure) return response;
    return resolveEditMessage();
  }

  if (toolName === "Glob" || (toolName === "global" && action === "list")) {
    if (isFailure) return response;
    return resolveGlobMessage();
  }

  return response;
};

export const runSimpleAgentWorkflow = async ({
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
}: RunSimpleAgentWorkflowInput): Promise<RunSimpleAgentWorkflowResult> => {
  const flowResponses: SimpleWorkflowNodeResponse[] = [];
  const isKimiModel = /kimi/i.test(selectedModel || "");
  const streamedToolCallIds = new Set<string>();
  const streamedToolParamIds = new Set<string>();

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
      onEvent?.(SseResponseEventEnum.answer, { text });
    },
    onReasoning: ({ text }) => {
      if (!text) return;
      onEvent?.(SseResponseEventEnum.reasoning, { text });
    },
    onToolCall: ({ call }) => {
      const toolCallId = typeof call?.id === "string" ? call.id : "";
      const toolName = typeof call?.function?.name === "string" ? call.function.name : "";
      if (!toolCallId || !toolName) return;
      streamedToolCallIds.add(toolCallId);
      onEvent?.(SseResponseEventEnum.toolCall, {
        id: toolCallId,
        toolName,
      });
    },
    onToolParam: ({ tool, params }) => {
      const toolCallId = typeof tool?.id === "string" ? tool.id : "";
      const toolName = typeof tool?.function?.name === "string" ? tool.function.name : "";
      if (!toolCallId || !toolName || !params) return;
      streamedToolParamIds.add(toolCallId);
      onEvent?.(SseResponseEventEnum.toolParams, {
        id: toolCallId,
        toolName,
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

      const toolName = call.function.name;
      const argDiagnosis = inspectRawToolArgs(call.function.arguments);
      const params = formatToolArgs(call.function.arguments);
      // Emit tool lifecycle events from execution phase (after dedupe),
      // so UI cards reflect what actually runs.
      if (!streamedToolCallIds.has(call.id)) {
        onEvent?.(SseResponseEventEnum.toolCall, {
          id: call.id,
          toolName,
        });
      }
      if (params && !streamedToolParamIds.has(call.id)) {
        onEvent?.(SseResponseEventEnum.toolParams, {
          id: call.id,
          toolName,
          params,
        });
      }

      if (!response) {
        if (!tool) {
          status = "error";
          response = `未找到工具: ${call.function.name}`;
        } else {
          try {
            const parsed = toSafeToolArgs(call.function.arguments);
            if (toolName === "Write" && !isValidWriteFileArgs(parsed)) {
              status = "error";
              response = [
                "Write 参数不完整或被截断：需要完整 JSON 且必须包含字符串字段 file_path、content。",
                "请重试该工具调用，并只写一个文件（不要并行多个 Write），必要时缩短单次 content 长度。",
                `raw_args_snippet=${toRawToolArgSnippet(call.function.arguments) || "<empty>"}`,
                `diagnosis=${JSON.stringify(argDiagnosis)}`,
              ].join(" ");
            } else {
            const result = await tool.run(parsed);
            response = typeof result === "string" ? result : JSON.stringify(result);
            }
          } catch (error) {
            status = "error";
            response = error instanceof Error ? error.message : "工具执行失败";
          }
        }
      }

      const runningTime = Number(((Date.now() - startAt) / 1000).toFixed(2));
      const modelResponse = mapToolResponseForModel(toolName, response);
      const parsedToolResponse = parseToolResponse(modelResponse);
      if (
        status === "success" &&
        parsedToolResponse &&
        typeof parsedToolResponse === "object" &&
        !Array.isArray(parsedToolResponse) &&
        (parsedToolResponse as Record<string, unknown>).ok === false
      ) {
        status = "error";
      }

      console.info(
        "[agent-debug][tool-call-result]",
        JSON.stringify(
          {
            model: selectedModel,
            isKimiModel,
            toolCallId: call.id,
            toolName,
            status,
            runningTime,
            argsRawLength: (call.function.arguments || "").length,
            argsDisplayLength: params.length,
            argsJsonValid: argDiagnosis.jsonValid,
            argsEndsWithJsonCloser: argDiagnosis.endsWithJsonCloser,
            argsLikelyTruncated: argDiagnosis.likelyTruncated,
            argsTail: argDiagnosis.rawTail,
            rawResponseLength: response.length,
            modelResponseLength: modelResponse.length,
            paramsPreview: toDebugSnippet(params),
            rawResponsePreview: toDebugSnippet(response),
            modelResponsePreview: toDebugSnippet(modelResponse),
          },
          null,
          2
        )
      );

      onEvent?.(SseResponseEventEnum.toolResponse, {
        id: call.id,
        toolName,
        params,
        response: modelResponse,
        rawResponse: response,
      });

      const nodeResponse: SimpleWorkflowNodeResponse = {
        nodeId: `tool:${toolName}`,
        moduleName: toolName,
        moduleType: "tool",
        runningTime,
        status,
        toolInput: toSafeToolArgs(call.function.arguments),
        toolRes: parsedToolResponse,
      };
      flowResponses.push(nodeResponse);

      onEvent?.(SseResponseEventEnum.flowNodeResponse, nodeResponse as unknown as Record<string, unknown>);

      // Feed the model with direct tool output instead of an extra JSON wrapper.
      // Some models (e.g. kimi series) are less robust when the actual payload is nested as a string field.
      const toolContent = modelResponse;

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
