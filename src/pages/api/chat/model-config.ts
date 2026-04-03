import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAuth } from "@server/auth/session";
import { listModelIcons } from "@server/aiProxy/modelConfigStore";
import { normalizeUserModelConfigs } from "@server/auth/userModelConfig";
import { updateUserCustomModels } from "@server/auth/userStore";

const jsonRecord = z.record(z.string(), z.unknown());

const modelSchema = z.object({
  id: z.string().trim().min(1, "模型 ID 不能为空").max(200, "模型 ID 过长"),
  label: z.string().trim().max(200, "模型名称过长").optional().or(z.literal("")),
  icon: z.string().trim().max(200, "图标字段过长").optional().or(z.literal("")),
  protocol: z.string().trim().max(80, "protocol 过长").optional().or(z.literal("")),
  baseUrl: z.string().trim().max(500, "baseUrl 过长").optional().or(z.literal("")),
  key: z.string().trim().max(1000, "key 过长").optional().or(z.literal("")),
  maxContext: z.number().int().positive("maxContext 必须为正整数").optional(),
  maxResponse: z.number().int().positive("maxResponse 必须为正整数").optional(),
  quoteMaxToken: z.number().int().positive("quoteMaxToken 必须为正整数").optional(),
  maxTemperature: z.number().nonnegative("maxTemperature 不能为负数").optional(),
  reasoning: z.boolean().optional(),
  vision: z.boolean().optional(),
  visionModel: z.string().trim().max(200, "visionModel 过长").optional().or(z.literal("")),
  toolChoice: z.string().trim().max(80, "toolChoice 过长").optional().or(z.literal("")),
  toolChoiceMode: z.string().trim().max(80, "toolChoiceMode 过长").optional().or(z.literal("")),
  forceToolChoice: z.string().trim().max(80, "forceToolChoice 过长").optional().or(z.literal("")),
  defaultConfig: jsonRecord.optional(),
  fieldMap: jsonRecord.optional(),
});

const payloadSchema = z.object({
  models: z.array(modelSchema).max(200, "模型数量过多"),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method === "GET") {
    const iconOptions = await listModelIcons();
    const models = normalizeUserModelConfigs(auth.user.customModels);
    res.status(200).json({
      scope: "user",
      models,
      iconOptions,
    });
    return;
  }

  if (req.method === "PATCH") {
    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "参数错误" });
      return;
    }

    const nextModels = parsed.data.models.map((item) => {
      const normalized = { ...item };
      if ("label" in normalized && !normalized.label?.trim()) delete normalized.label;
      if ("icon" in normalized && !normalized.icon?.trim()) delete normalized.icon;
      if ("protocol" in normalized && !normalized.protocol?.trim()) delete normalized.protocol;
      if ("baseUrl" in normalized && !normalized.baseUrl?.trim()) delete normalized.baseUrl;
      if ("key" in normalized && !normalized.key?.trim()) delete normalized.key;
      if ("visionModel" in normalized && !normalized.visionModel?.trim()) delete normalized.visionModel;
      if ("toolChoice" in normalized && !normalized.toolChoice?.trim()) delete normalized.toolChoice;
      if ("toolChoiceMode" in normalized && !normalized.toolChoiceMode?.trim()) delete normalized.toolChoiceMode;
      if ("forceToolChoice" in normalized && !normalized.forceToolChoice?.trim()) delete normalized.forceToolChoice;
      if (normalized.defaultConfig && Object.keys(normalized.defaultConfig).length === 0) delete normalized.defaultConfig;
      if (normalized.fieldMap && Object.keys(normalized.fieldMap).length === 0) delete normalized.fieldMap;
      return normalized;
    });

    const models = normalizeUserModelConfigs(nextModels);
    const updated = await updateUserCustomModels(String(auth.user._id), models);
    if (!updated) {
      res.status(500).json({ error: "保存失败，请稍后重试" });
      return;
    }
    res.status(200).json({
      success: true,
      scope: "user",
      models,
    });
    return;
  }

  res.setHeader("Allow", ["GET", "PATCH"]);
  res.status(405).json({ error: `方法 ${req.method} 不被允许` });
}
