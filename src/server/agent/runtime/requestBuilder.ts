import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "@aistudio/ai/compat/global/core/ai/type";

type BuildRuntimeRequestInput = {
  selectedModel: string;
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
  temperature: number;
  stream: boolean;
  toolChoice?: "auto" | "required";
  thinking?: { type: "enabled" | "disabled" };
};

export const buildRuntimeRequestBody = ({
  selectedModel,
  messages,
  tools,
  temperature,
  stream,
  toolChoice,
  thinking,
}: BuildRuntimeRequestInput) => ({
  model: selectedModel,
  messages,
  max_tokens: undefined,
  tools,
  temperature,
  stream,
  useVision: false,
  requestOrigin: process.env.STORAGE_EXTERNAL_ENDPOINT || "http://127.0.0.1:3000",
  tool_choice: toolChoice,
  toolCallMode: "toolChoice" as const,
  ...(thinking ? { thinking } : {}),
});

