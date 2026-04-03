import { getChatModelCatalog } from "@server/aiProxy/catalogStore";
import { requireAuth } from "@server/auth/session";
import { getUserModelConfigsFromUser } from "@server/auth/userModelConfig";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const forceRefresh = req.query.refresh === "1";
  const key = typeof req.query.key === "string" ? req.query.key : undefined;
  const systemCatalog = await getChatModelCatalog({ forceRefresh, key });
  const userModels = getUserModelConfigsFromUser(auth.user);

  const mergedModels = [
    ...userModels.map((item) => ({
      id: item.id,
      label: item.label || item.id,
      channel: "user",
      source: "user" as const,
      icon: item.icon,
      reasoning: item.reasoning,
      scope: "user" as const,
    })),
    ...systemCatalog.models.map((item) => ({
      ...item,
      scope: "system" as const,
    })),
  ];

  const mergedModelIds = new Set(mergedModels.map((item) => item.id));
  const preferred = typeof auth.user.primaryModel === "string" ? auth.user.primaryModel.trim() : "";
  const defaultModel =
    (preferred && mergedModelIds.has(preferred) ? preferred : undefined) ||
    (mergedModelIds.has(systemCatalog.defaultModel) ? systemCatalog.defaultModel : undefined) ||
    mergedModels[0]?.id ||
    systemCatalog.defaultModel;
  const defaultChannel = mergedModels.find((item) => item.id === defaultModel)?.channel || systemCatalog.defaultChannel;

  res.status(200).json({
    ...systemCatalog,
    models: mergedModels,
    channels: [
      { id: "user", label: "用户模型", source: "user" as const },
      ...systemCatalog.channels,
    ],
    defaultChannel,
    defaultModel,
    groups: [
      {
        id: "user",
        label: "用户模型",
        models: mergedModels.filter((item) => item.scope === "user").map((item) => item.id),
      },
      {
        id: "system",
        label: "系统模型",
        models: mergedModels.filter((item) => item.scope === "system").map((item) => item.id),
      },
    ],
  });
}
