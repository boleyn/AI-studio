import type {
  ChatCompletion, ChatCompletionChunk, ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { createChatCompletion } from "@aistudio/ai/llm/request";
import { ModelTypeEnum } from "@aistudio/ai/compat/global/core/ai/model";
import { getOpenAIClient } from "./config";

export type AgentModelConnection = {
  protocol: "openai" | "anthropic" | "google";
  baseURL: string;
  apiKey: string;
  maxContext?: number;
  maxTemperature?: number;
  reasoning?: boolean;
  vision?: boolean;
};

export type AgentModelClient = {
  stream: (body: ChatCompletionCreateParamsStreaming, signal?: AbortSignal) => Promise<AsyncIterable<ChatCompletionChunk>>;
  complete: (body: ChatCompletionCreateParamsNonStreaming, signal?: AbortSignal) => Promise<ChatCompletion>;
};

export function createAgentModelClient(model: string, maxContext: number, connection?: AgentModelConnection): AgentModelClient {
  if (!connection || connection.protocol === "openai") {
    const client = connection
      ? getOpenAIClient({ baseURL: connection.baseURL, apiKey: connection.apiKey })
      : getOpenAIClient();
    return {
      stream: (body, signal) => client.chat.completions.create(body, { signal }),
      complete: (body, signal) => client.chat.completions.create(body, { signal }),
    };
  }

  const request = (body: ChatCompletionCreateParamsStreaming | ChatCompletionCreateParamsNonStreaming, signal?: AbortSignal) =>
    createChatCompletion({
      modelData: {
        type: ModelTypeEnum.llm,
        provider: connection.protocol,
        protocol: connection.protocol,
        model,
        name: model,
        baseUrl: connection.baseURL,
        key: connection.apiKey,
        maxContext,
        reasoning: connection.reasoning,
        vision: connection.vision,
        functionCall: true,
        toolChoice: true,
      },
      body,
      options: { signal },
    });

  return {
    async stream(body, signal) {
      const result = await request(body, signal);
      if (!result.isStreamResponse) throw new Error("模型没有返回流式响应。");
      return result.response;
    },
    async complete(body, signal) {
      const result = await request(body, signal);
      if (result.isStreamResponse) throw new Error("模型没有返回完整响应。");
      return result.response;
    },
  };
}
