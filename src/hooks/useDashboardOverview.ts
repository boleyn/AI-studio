import { useCallback, useEffect, useState } from "react";

import { withAuthHeaders } from "@features/auth/client/authClient";

type DashboardOverview = {
  projects: {
    total: number;
    addedThisMonth: number;
  };
  skills: {
    published: number;
    pending: number;
    publishedRate: number;
  };
  sessions: {
    totalSessions: number;
    totalMessages: number;
    avgMessagesPerSession: number;
  };
  generatedAt: string;
};

const EMPTY_OVERVIEW: DashboardOverview = {
  projects: { total: 0, addedThisMonth: 0 },
  skills: { published: 0, pending: 0, publishedRate: 0 },
  sessions: { totalSessions: 0, totalMessages: 0, avgMessagesPerSession: 0 },
  generatedAt: "",
};

export function useDashboardOverview() {
  const [overview, setOverview] = useState<DashboardOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/dashboard/overview", {
        headers: withAuthHeaders(),
      });
      if (!response.ok) {
        setOverview(EMPTY_OVERVIEW);
        return;
      }
      const payload = (await response.json()) as DashboardOverview;
      if (!payload || typeof payload !== "object") {
        setOverview(EMPTY_OVERVIEW);
        return;
      }
      setOverview(payload);
    } catch {
      setOverview(EMPTY_OVERVIEW);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const handleFocus = () => {
      void loadOverview();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadOverview();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadOverview]);

  return {
    overview,
    loading,
    loadOverview,
  };
}
