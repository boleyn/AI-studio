import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { createChatCompletion } from "@aistudio/ai/llm/request";
import { ModelTypeEnum } from "@aistudio/ai/compat/global/core/ai/model";
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

const maskSecret = (value: string) => {
  if (!value) return "";
  if (value.length <= 8) return `${"*".repeat(Math.max(value.length - 2, 0))}${value.slice(-2)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
};

const getRawErrorText = (error: unknown) => {
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
};

const cleanErrorText = (value: string) => {
  const withoutTags = value.replace(/<[^>]+>/g, " ");
  return withoutTags.replace(/\s+/g, " ").trim();
};

const toReadableError = (error: unknown): { message: string; hint?: string; detail?: string } => {
  const raw = cleanErrorText(getRawErrorText(error));
  const lower = raw.toLowerCase();
  const detail = raw ? raw.slice(0, 220) : undefined;

  if (!raw) {
    return { message: "模型测试失败", hint: "请检查模型配置后重试。" };
  }
  if (lower.includes("缺少 baseurl")) {
    return { message: "模型测试失败：缺少 Base URL", hint: "请填写可访问的模型服务地址。", detail };
  }
  if (lower.includes("缺少 key") || lower.includes("api key")) {
    return { message: "模型测试失败：API Key 无效", hint: "请检查 Key 是否填写正确、是否过期。", detail };
  }
  if (/(401|unauthorized|invalid[_\s-]?api[_\s-]?key|incorrect api key)/i.test(raw)) {
    return { message: "模型测试失败：鉴权未通过", hint: "请确认 API Key 与 Base URL 配套。", detail };
  }
  if (/(404|model.+not found|no such model)/i.test(raw)) {
    return { message: "模型测试失败：模型不存在", hint: "请检查模型 ID 是否正确。", detail };
  }
  if (/(429|rate limit|quota|insufficient_quota)/i.test(raw)) {
    return { message: "模型测试失败：额度或限流", hint: "请检查账户额度，或稍后再试。", detail };
  }
  if (/(timeout|timed out|etimedout|aborted)/i.test(raw)) {
    return { message: "模型测试失败：请求超时", hint: "请检查网络连通性或更换更快的服务地址。", detail };
  }
  if (/(enotfound|eai_again|fetch failed|network|connection)/i.test(raw)) {
    return { message: "模型测试失败：网络不可达", hint: "请检查 Base URL 是否可访问。", detail };
  }
  return { message: "模型测试失败", hint: "请根据错误细节检查配置。", detail };
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
  const protocol = (model.protocol || "openai").trim() || "openai";
  const baseUrl = model.baseUrl.trim();
  const apiKey = model.key.trim();
  const maxContext = Number.isFinite(Number(model.maxContext)) && Number(model.maxContext) > 0
    ? Math.floor(Number(model.maxContext))
    : 16000;
  const maxResponse = Number.isFinite(Number(model.maxResponse)) && Number(model.maxResponse) > 0
    ? Math.floor(Number(model.maxResponse))
    : 256;
  const quoteMaxToken = Math.min(2000, Math.max(256, maxContext - maxResponse));

  try {
    console.info("[model-config-test] start", {
      userId: String(auth.user._id),
      model: modelId,
      protocol,
      baseUrl,
      keyMasked: maskSecret(apiKey),
      keyLength: apiKey.length,
      keyHasBearerPrefix: /^Bearer\s+/i.test(apiKey),
    });

    const { response, isStreamResponse } = await createChatCompletion({
      modelData: {
        type: ModelTypeEnum.llm,
        provider: "OpenAI",
        model: modelId,
        name: (model.label || "").trim() || modelId,
        protocol,
        baseUrl,
        key: apiKey,
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
      userKey: {
        baseUrl,
        key: apiKey,
      },
      options: {
        headers: {
          Authorization: /^Bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`,
        },
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
    const readable = toReadableError(error);
    console.warn("[model-config-test] failed", {
      userId: String(auth.user._id),
      model: modelId,
      protocol,
      baseUrl,
      keyMasked: maskSecret(apiKey),
      keyLength: apiKey.length,
      keyHasBearerPrefix: /^Bearer\s+/i.test(apiKey),
      error: readable.message,
      detail: readable.detail,
    });
    res.status(502).json({
      success: false,
      error: readable.message,
      hint: readable.hint,
      detail: readable.detail,
    });
  }
}
