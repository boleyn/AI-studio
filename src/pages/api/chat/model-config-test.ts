import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { createChatCompletion } from "@ai/llm/request";
import { ModelTypeEnum } from "@ai/compat/global/core/ai/model";
import { requireAuth } from "@server/auth/session";

const testModelSchema = z.object({
  id: z.string().trim().min(1, "模型 ID 不能为空").max(200, "模型 ID 过长"),
  label: z.string().trim().max(200, "模型名称过长").optional().or(z.literal("")),
  protocol: z.string().trim().max(80, "protocol 过长").optional().or(z.literal("")),
  baseUrl: z.string().trim().min(1, "Base URL 不能为空").max(500, "baseUrl 过长"),
  key: z.string().trim().min(1, "API Key 不能为空").max(1000, "key 过长"),
  maxContext: z.number().int().positive("maxContext 必须为正整数").optional(),
  maxResponse: z.number().int().positive("maxResponse 必须为正整数").optional(),
  reasoning: z.boolean().optional(),
  vision: z.boolean().optional(),
});

const payloadSchema = z.object({
  model: testModelSchema,
});

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  return "模型测试失败";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "参数错误" });
    return;
  }

  const model = parsed.data.model;
  const modelId = model.id.trim();
  const maxContext = Number.isFinite(Number(model.maxContext)) && Number(model.maxContext) > 0
    ? Math.floor(Number(model.maxContext))
    : 16000;
  const maxResponse = Number.isFinite(Number(model.maxResponse)) && Number(model.maxResponse) > 0
    ? Math.floor(Number(model.maxResponse))
    : 256;
  const quoteMaxToken = Math.min(2000, Math.max(256, maxContext - maxResponse));

  try {
    const { response, isStreamResponse } = await createChatCompletion({
      modelData: {
        type: ModelTypeEnum.llm,
        provider: "OpenAI",
        model: modelId,
        name: (model.label || "").trim() || modelId,
        protocol: (model.protocol || "openai").trim() || "openai",
        baseUrl: model.baseUrl.trim(),
        key: model.key.trim(),
        maxContext,
        maxResponse,
        quoteMaxToken,
        reasoning: Boolean(model.reasoning),
        vision: Boolean(model.vision),
        functionCall: true,
        toolChoice: true,
      },
      body: {
        model: modelId,
        stream: false,
        temperature: 0,
        max_tokens: Math.min(32, maxResponse),
        messages: [
          {
            role: "user",
            content: "Reply with OK.",
          },
        ],
      },
      timeout: 20000,
    });

    if (isStreamResponse) {
      res.status(200).json({
        success: true,
        message: "模型测试通过",
      });
      return;
    }

    const output = typeof response?.choices?.[0]?.message?.content === "string"
      ? response.choices[0].message.content
      : "";

    res.status(200).json({
      success: true,
      message: "模型测试通过",
      output,
    });
  } catch (error) {
    res.status(502).json({
      success: false,
      error: toErrorMessage(error),
    });
  }
}
