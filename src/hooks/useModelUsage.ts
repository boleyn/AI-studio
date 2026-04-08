import { useCallback, useEffect, useRef, useState } from "react";

import { withAuthHeaders } from "@features/auth/client/authClient";

export type ModelUsageItem = {
  modelId: string;
  label: string;
  icon?: string;
  scope: "user" | "system" | "unknown";
  calls: number;
  totalUsedTokens: number;
  avgUsedPercent: number;
  lastUsedAt?: string;
};

export type ModelUsageTrendPoint = {
  date: string;
  calls: number;
  totalUsedTokens: number;
  avgUsedPercent: number;
};

type ModelUsageResponse = {
  summary: {
    totalCalls: number;
    totalUsedTokens: number;
    activeModels: number;
    generatedAt: string;
  };
  trendWindow: string[];
  trends: Record<string, ModelUsageTrendPoint[]>;
  items: ModelUsageItem[];
};

const EMPTY: ModelUsageResponse = {
  summary: {
    totalCalls: 0,
    totalUsedTokens: 0,
    activeModels: 0,
    generatedAt: "",
  },
  trendWindow: [],
  trends: {},
  items: [],
};

export function useModelUsage(windowDays = 7) {
  const [data, setData] = useState<ModelUsageResponse>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedRef = useRef(false);

  const loadModelUsage = useCallback(async () => {
    const isSilentRefresh = hasLoadedRef.current;
    if (isSilentRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`/api/dashboard/model-usage?days=${encodeURIComponent(String(windowDays))}`, {
        headers: withAuthHeaders(),
        signal: controller.signal,
      });
      if (!response.ok) {
        setData(EMPTY);
        return;
      }
      const payload = (await response.json()) as ModelUsageResponse;
      if (!payload || typeof payload !== "object") {
        setData(EMPTY);
        return;
      }
      setData({
        summary: {
          totalCalls: Number(payload.summary?.totalCalls || 0),
          totalUsedTokens: Number(payload.summary?.totalUsedTokens || 0),
          activeModels: Number(payload.summary?.activeModels || 0),
          generatedAt: String(payload.summary?.generatedAt || ""),
        },
        trendWindow: Array.isArray(payload.trendWindow) ? payload.trendWindow : [],
        trends: payload.trends && typeof payload.trends === "object" ? payload.trends : {},
        items: Array.isArray(payload.items) ? payload.items : [],
      });
    } catch {
      setData(EMPTY);
    } finally {
      clearTimeout(timer);
      if (isSilentRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
      hasLoadedRef.current = true;
    }
  }, [windowDays]);

  useEffect(() => {
    void loadModelUsage();
  }, [loadModelUsage]);

  return {
    data,
    loading,
    refreshing,
    loadModelUsage,
  };
}
