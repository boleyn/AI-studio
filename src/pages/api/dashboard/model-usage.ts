import type { NextApiRequest, NextApiResponse } from "next";

import { getChatModelCatalog } from "@server/aiProxy/catalogStore";
import { requireAuth } from "@server/auth/session";
import { getUserModelConfigsFromUser } from "@server/auth/userModelConfig";
import { getMongoDb } from "@server/db/mongo";
import { listProjectOverviewItems } from "@server/projects/projectStorage";
import { listUserSkills } from "@server/skills/skillStorage";

type ModelUsageItem = {
  modelId: string;
  label: string;
  icon?: string;
  scope: "user" | "system" | "unknown";
  calls: number;
  totalUsedTokens: number;
  avgUsedPercent: number;
  lastUsedAt?: string;
};

type ModelUsageResponse = {
  summary: {
    totalCalls: number;
    totalUsedTokens: number;
    activeModels: number;
    generatedAt: string;
  };
  trendWindow: string[];
  trends: Record<
    string,
    Array<{
      date: string;
      calls: number;
      totalUsedTokens: number;
      avgUsedPercent: number;
    }>
  >;
  items: ModelUsageItem[];
  toolUsage?: {
    summary: {
      totalCalls: number;
      totalUsedTokens: number;
      activeModels: number;
    };
    trendWindow: string[];
    trends: Record<
      string,
      Array<{
        date: string;
        calls: number;
        totalUsedTokens: number;
        avgUsedPercent: number;
      }>
    >;
    items: ModelUsageItem[];
  };
};

type UsageAggRow = {
  _id: string;
  calls?: number;
  totalUsedTokens?: number;
  avgUsedPercent?: number;
  lastUsedAt?: Date;
};

type UsageTrendAggRow = {
  _id?: {
    modelId?: string;
    day?: string;
  };
  calls?: number;
  totalUsedTokens?: number;
  avgUsedPercent?: number;
};

type VisionUsageAggRow = {
  _id: string;
  calls?: number;
  totalUsedTokens?: number;
  avgUsedPercent?: number;
  lastUsedAt?: Date;
};

type VisionUsageTrendAggRow = {
  _id?: {
    modelId?: string;
    day?: string;
  };
  calls?: number;
  totalUsedTokens?: number;
  avgUsedPercent?: number;
};

const toSafeNumber = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return n;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ModelUsageResponse | { error: string }>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const userId = auth.user._id != null ? String(auth.user._id) : "";
  if (!userId) {
    res.status(401).json({ error: "用户身份无效" });
    return;
  }

  const trendDays = 7;
  const trendTimezone = "Asia/Shanghai";
  const requestedDays = Number(req.query.days || 7);
  const safeTrendDays = Number.isFinite(requestedDays) ? Math.max(7, Math.min(30, Math.floor(requestedDays))) : 7;
  const getDateKey = (date: Date) => {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: trendTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  };
  const trendWindow = Array.from({ length: safeTrendDays }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (safeTrendDays - 1 - index));
    return getDateKey(date);
  });

  try {
    const [projects, skills, catalog] = await Promise.all([
      listProjectOverviewItems(userId),
      listUserSkills({ userId }),
      getChatModelCatalog(),
    ]);

    const userModels = getUserModelConfigsFromUser(auth.user);
    const userModelIds = new Set(userModels.map((m) => m.id));

    const mergedCatalog = new Map<string, { label: string; icon?: string; scope: "user" | "system" }>();

    userModels.forEach((item) => {
      if (!item.id) return;
      mergedCatalog.set(item.id, {
        label: item.label || item.id,
        icon: item.icon,
        scope: "user",
      });
    });

    catalog.models.forEach((item) => {
      if (!item.id || mergedCatalog.has(item.id)) return;
      mergedCatalog.set(item.id, {
        label: item.label || item.id,
        icon: item.icon,
        scope: userModelIds.has(item.id) ? "user" : "system",
      });
    });

    const tokenSet = new Set<string>();
    projects.forEach((item) => {
      if (item.token) tokenSet.add(item.token);
    });
    skills.forEach((item) => {
      if (item.token) tokenSet.add(item.token);
    });

    const tokens = Array.from(tokenSet);
    let usageRows: UsageAggRow[] = [];
    let usageTrendRows: UsageTrendAggRow[] = [];
    let visionUsageRows: VisionUsageAggRow[] = [];
    let visionUsageTrendRows: VisionUsageTrendAggRow[] = [];

    if (tokens.length > 0) {
      const db = await getMongoDb();
      const itemCol = db.collection("conversation_items");
      const usageEventCol = db.collection("model_usage_events");
      usageRows = (await itemCol
        .aggregate([
          {
            $match: {
              token: { $in: tokens },
              role: "assistant",
              "additional_kwargs.contextWindow.model": { $type: "string", $ne: "" },
            },
          },
          {
            $group: {
              _id: "$additional_kwargs.contextWindow.model",
              calls: { $sum: 1 },
              totalUsedTokens: {
                $sum: {
                  $cond: [
                    { $isNumber: "$additional_kwargs.contextWindow.usedTokens" },
                    "$additional_kwargs.contextWindow.usedTokens",
                    0,
                  ],
                },
              },
              avgUsedPercent: {
                $avg: {
                  $cond: [
                    { $isNumber: "$additional_kwargs.contextWindow.usedPercent" },
                    "$additional_kwargs.contextWindow.usedPercent",
                    0,
                  ],
                },
              },
              lastUsedAt: { $max: "$time" },
            },
          },
        ])
        .toArray()) as UsageAggRow[];

      usageTrendRows = (await itemCol
        .aggregate([
          {
            $match: {
              token: { $in: tokens },
              role: "assistant",
              "additional_kwargs.contextWindow.model": { $type: "string", $ne: "" },
            },
          },
          {
            $project: {
              modelId: "$additional_kwargs.contextWindow.model",
              day: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$time",
                  timezone: trendTimezone,
                },
              },
              usedTokens: {
                $cond: [
                  { $isNumber: "$additional_kwargs.contextWindow.usedTokens" },
                  "$additional_kwargs.contextWindow.usedTokens",
                  0,
                ],
              },
              usedPercent: {
                $cond: [
                  { $isNumber: "$additional_kwargs.contextWindow.usedPercent" },
                  "$additional_kwargs.contextWindow.usedPercent",
                  null,
                ],
              },
            },
          },
          {
            $match: {
              day: { $in: trendWindow },
            },
          },
          {
            $group: {
              _id: {
                modelId: "$modelId",
                day: "$day",
              },
              calls: { $sum: 1 },
              totalUsedTokens: { $sum: "$usedTokens" },
              avgUsedPercent: { $avg: "$usedPercent" },
            },
          },
        ])
        .toArray()) as UsageTrendAggRow[];

      visionUsageRows = (await usageEventCol
        .aggregate([
          {
            $match: {
              token: { $in: tokens },
              source: "image_vision",
              modelId: { $type: "string", $ne: "" },
            },
          },
          {
            $group: {
              _id: "$modelId",
              calls: { $sum: 1 },
              totalUsedTokens: {
                $sum: {
                  $cond: [{ $isNumber: "$usedTokens" }, "$usedTokens", 0],
                },
              },
              avgUsedPercent: {
                $avg: {
                  $cond: [{ $isNumber: "$usedPercent" }, "$usedPercent", 0],
                },
              },
              lastUsedAt: { $max: "$time" },
            },
          },
        ])
        .toArray()) as VisionUsageAggRow[];

      visionUsageTrendRows = (await usageEventCol
        .aggregate([
          {
            $match: {
              token: { $in: tokens },
              source: "image_vision",
              modelId: { $type: "string", $ne: "" },
            },
          },
          {
            $project: {
              modelId: "$modelId",
              day: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$time",
                  timezone: trendTimezone,
                },
              },
              usedTokens: {
                $cond: [{ $isNumber: "$usedTokens" }, "$usedTokens", 0],
              },
              usedPercent: {
                $cond: [{ $isNumber: "$usedPercent" }, "$usedPercent", null],
              },
            },
          },
          {
            $match: {
              day: { $in: trendWindow },
            },
          },
          {
            $group: {
              _id: {
                modelId: "$modelId",
                day: "$day",
              },
              calls: { $sum: 1 },
              totalUsedTokens: { $sum: "$usedTokens" },
              avgUsedPercent: { $avg: "$usedPercent" },
            },
          },
        ])
        .toArray()) as VisionUsageTrendAggRow[];
    }

    const usageByModel = new Map<string, UsageAggRow>();
    usageRows.forEach((row) => {
      const modelId = typeof row._id === "string" ? row._id.trim() : "";
      if (!modelId) return;
      usageByModel.set(modelId, row);
    });

    const allModelIds = new Set<string>([...mergedCatalog.keys(), ...usageByModel.keys()]);

    const items: ModelUsageItem[] = Array.from(allModelIds)
      .map((modelId) => {
        const meta = mergedCatalog.get(modelId);
        const usage = usageByModel.get(modelId);
        const scope: ModelUsageItem["scope"] = meta?.scope ?? "unknown";
        return {
          modelId,
          label: meta?.label || modelId,
          icon: meta?.icon,
          scope,
          calls: Math.max(0, Math.floor(toSafeNumber(usage?.calls))),
          totalUsedTokens: Math.max(0, Math.floor(toSafeNumber(usage?.totalUsedTokens))),
          avgUsedPercent: Number(Math.max(0, Math.min(100, toSafeNumber(usage?.avgUsedPercent))).toFixed(1)),
          lastUsedAt:
            usage?.lastUsedAt instanceof Date && !Number.isNaN(usage.lastUsedAt.getTime())
              ? usage.lastUsedAt.toISOString()
              : undefined,
        };
      })
      .sort((a, b) => {
        if (b.calls !== a.calls) return b.calls - a.calls;
        if (b.totalUsedTokens !== a.totalUsedTokens) return b.totalUsedTokens - a.totalUsedTokens;
        return a.label.localeCompare(b.label, "zh-CN");
      });

    const trendMap = new Map<string, Map<string, { calls: number; totalUsedTokens: number; avgUsedPercent: number }>>();
    usageTrendRows.forEach((row) => {
      const modelId = typeof row?._id?.modelId === "string" ? row._id.modelId.trim() : "";
      const day = typeof row?._id?.day === "string" ? row._id.day : "";
      if (!modelId || !day) return;
      if (!trendMap.has(modelId)) trendMap.set(modelId, new Map());
      trendMap.get(modelId)!.set(day, {
        calls: Math.max(0, Math.floor(toSafeNumber(row.calls))),
        totalUsedTokens: Math.max(0, Math.floor(toSafeNumber(row.totalUsedTokens))),
        avgUsedPercent: Number(Math.max(0, Math.min(100, toSafeNumber(row.avgUsedPercent))).toFixed(1)),
      });
    });
    const toolUsageByModel = new Map<string, VisionUsageAggRow>();
    visionUsageRows.forEach((row) => {
      const modelId = typeof row._id === "string" ? row._id.trim() : "";
      if (!modelId) return;
      toolUsageByModel.set(modelId, row);
    });

    const allToolModelIds = new Set<string>([
      ...Array.from(toolUsageByModel.keys()),
      ...visionUsageTrendRows
        .map((row) => (typeof row?._id?.modelId === "string" ? row._id.modelId.trim() : ""))
        .filter(Boolean),
    ]);

    const toolItems: ModelUsageItem[] = Array.from(allToolModelIds)
      .map((modelId) => {
        const meta = mergedCatalog.get(modelId);
        const usage = toolUsageByModel.get(modelId);
        const scope: ModelUsageItem["scope"] = meta?.scope ?? "unknown";
        return {
          modelId,
          label: meta?.label || modelId,
          icon: meta?.icon,
          scope,
          calls: Math.max(0, Math.floor(toSafeNumber(usage?.calls))),
          totalUsedTokens: Math.max(0, Math.floor(toSafeNumber(usage?.totalUsedTokens))),
          avgUsedPercent: Number(Math.max(0, Math.min(100, toSafeNumber(usage?.avgUsedPercent))).toFixed(1)),
          lastUsedAt:
            usage?.lastUsedAt instanceof Date && !Number.isNaN(usage.lastUsedAt.getTime())
              ? usage.lastUsedAt.toISOString()
              : undefined,
        };
      })
      .sort((a, b) => {
        if (b.calls !== a.calls) return b.calls - a.calls;
        if (b.totalUsedTokens !== a.totalUsedTokens) return b.totalUsedTokens - a.totalUsedTokens;
        return a.label.localeCompare(b.label, "zh-CN");
      });

    const toolTrendMap = new Map<string, Map<string, { calls: number; totalUsedTokens: number; avgUsedPercent: number }>>();
    visionUsageTrendRows.forEach((row) => {
      const modelId = typeof row?._id?.modelId === "string" ? row._id.modelId.trim() : "";
      const day = typeof row?._id?.day === "string" ? row._id.day : "";
      if (!modelId || !day) return;
      if (!toolTrendMap.has(modelId)) toolTrendMap.set(modelId, new Map());
      toolTrendMap.get(modelId)!.set(day, {
        calls: Math.max(0, Math.floor(toSafeNumber(row.calls))),
        totalUsedTokens: Math.max(0, Math.floor(toSafeNumber(row.totalUsedTokens))),
        avgUsedPercent: Number(Math.max(0, Math.min(100, toSafeNumber(row.avgUsedPercent))).toFixed(1)),
      });
    });

    const toolTrends: NonNullable<ModelUsageResponse["toolUsage"]>["trends"] = {};
    allToolModelIds.forEach((modelId) => {
      const modelTrend = toolTrendMap.get(modelId);
      toolTrends[modelId] = trendWindow.map((date) => {
        const point = modelTrend?.get(date);
        return {
          date,
          calls: point?.calls || 0,
          totalUsedTokens: point?.totalUsedTokens || 0,
          avgUsedPercent: point?.avgUsedPercent || 0,
        };
      });
    });

    const trends: ModelUsageResponse["trends"] = {};
    allModelIds.forEach((modelId) => {
      const modelTrend = trendMap.get(modelId);
      trends[modelId] = trendWindow.map((date) => {
        const point = modelTrend?.get(date);
        return {
          date,
          calls: point?.calls || 0,
          totalUsedTokens: point?.totalUsedTokens || 0,
          avgUsedPercent: point?.avgUsedPercent || 0,
        };
      });
    });

    const payload: ModelUsageResponse = {
      summary: {
        totalCalls: items.reduce((sum, item) => sum + item.calls, 0),
        totalUsedTokens: items.reduce((sum, item) => sum + item.totalUsedTokens, 0),
        activeModels: items.filter((item) => item.calls > 0).length,
        generatedAt: new Date().toISOString(),
      },
      trendWindow,
      trends,
      items,
      toolUsage: {
        summary: {
          totalCalls: toolItems.reduce((sum, item) => sum + item.calls, 0),
          totalUsedTokens: toolItems.reduce((sum, item) => sum + item.totalUsedTokens, 0),
          activeModels: toolItems.filter((item) => item.calls > 0).length,
        },
        trendWindow,
        trends: toolTrends,
        items: toolItems,
      },
    };

    res.setHeader("Cache-Control", "private, no-store, must-revalidate");
    res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取模型用量失败";
    res.status(500).json({ error: message });
  }
}
