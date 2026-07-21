import { getChatModelCatalog, getChatModelProfile } from "@server/aiProxy/catalogStore";
import { getOpenAIClient } from "@server/agent/services/api/openai/client";
import { appendModelUsageEvent } from "@server/usage/modelUsageEventStorage";

export type ImageCaptionMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export const modelSupportsVision = (modelId: string) => {
  const profile = getChatModelProfile(modelId);
  return profile?.vision === true;
};

export const resolveVisionModelForCaption = async (mainLoopModel: string) => {
  const profile = getChatModelProfile(mainLoopModel);
  if (typeof profile?.visionModel === "string" && profile.visionModel.trim()) {
    return profile.visionModel.trim();
  }
  const catalog = await getChatModelCatalog();
  const fallback = catalog.models.find((item) => item.vision)?.id;
  return fallback || null;
};

export const generateImageCaption = async (input: {
  mainLoopModel: string;
  imageBase64: string;
  mediaType: ImageCaptionMediaType;
  token?: string;
}) => {
  const visionModel = await resolveVisionModelForCaption(input.mainLoopModel);
  if (!visionModel) {
    throw new Error(`No vision model available for '${input.mainLoopModel}'`);
  }

  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: visionModel,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "请用中文客观描述这张图片的主要内容。" +
              "输出1-3句话，聚焦可见事实，不要臆测，不要额外解释。",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${input.mediaType};base64,${input.imageBase64}`,
            },
          },
        ],
      },
    ],
  } as any);

  const caption = response.choices?.[0]?.message?.content?.trim() || "";
  const usage = response.usage && typeof response.usage === "object" ? response.usage : undefined;
  const promptTokens =
    typeof (usage as { prompt_tokens?: unknown } | undefined)?.prompt_tokens === "number"
      ? ((usage as { prompt_tokens: number }).prompt_tokens || 0)
      : 0;
  const completionTokens =
    typeof (usage as { completion_tokens?: unknown } | undefined)?.completion_tokens === "number"
      ? ((usage as { completion_tokens: number }).completion_tokens || 0)
      : 0;

  const totalTokens = Math.max(0, Math.floor(promptTokens + completionTokens));

  if (input.token && totalTokens > 0) {
    await appendModelUsageEvent({
      token: input.token,
      modelId: visionModel,
      usedTokens: totalTokens,
      source: "image_vision",
    });
  }

  return {
    caption,
    visionModel,
    usage: {
      promptTokens: Math.max(0, Math.floor(promptTokens)),
      completionTokens: Math.max(0, Math.floor(completionTokens)),
      totalTokens,
    },
  };
};
