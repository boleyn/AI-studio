import type { NextApiRequest, NextApiResponse } from "next";

import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";
import { listProjectOverviewItems } from "@server/projects/projectStorage";
import { listUserSkills } from "@server/skills/skillStorage";

type DashboardOverviewResponse = {
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

const toSafeCount = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
};

const toSafeRate = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const toSafeAvg = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Number(numeric.toFixed(1));
};

const startOfCurrentMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  try {
    const [projectItems, skills] = await Promise.all([
      listProjectOverviewItems(userId),
      listUserSkills({ userId }),
    ]);

    const monthStart = startOfCurrentMonth().getTime();
    const addedThisMonth = projectItems.reduce((count, item) => {
      const createdAt = new Date(item.createdAt).getTime();
      if (Number.isFinite(createdAt) && createdAt >= monthStart) return count + 1;
      return count;
    }, 0);

    const published = skills.filter((skill) => typeof skill.publishedAt === "string" && skill.publishedAt.trim()).length;
    const pending = Math.max(0, skills.length - published);
    const publishedRate = skills.length > 0 ? Math.round((published / skills.length) * 100) : 0;

    const projectTokens = projectItems.map((item) => item.token).filter(Boolean);
    let totalSessions = 0;
    let totalMessages = 0;

    if (projectTokens.length > 0) {
      const db = await getMongoDb();
      const conversations = db.collection("conversations");
      const conversationItems = db.collection("conversation_items");

      const validChatId = { $type: "string", $ne: "" };
      totalSessions = await conversations.countDocuments({
        token: { $in: projectTokens },
        deleteTime: null,
        chatId: validChatId,
      });
      totalMessages = await conversationItems.countDocuments({
        token: { $in: projectTokens },
        chatId: validChatId,
      });
    }

    const avgMessagesPerSession = totalSessions > 0 ? totalMessages / totalSessions : 0;

    const payload: DashboardOverviewResponse = {
      projects: {
        total: toSafeCount(projectItems.length),
        addedThisMonth: toSafeCount(addedThisMonth),
      },
      skills: {
        published: toSafeCount(published),
        pending: toSafeCount(pending),
        publishedRate: toSafeRate(publishedRate),
      },
      sessions: {
        totalSessions: toSafeCount(totalSessions),
        totalMessages: toSafeCount(totalMessages),
        avgMessagesPerSession: toSafeAvg(avgMessagesPerSession),
      },
      generatedAt: new Date().toISOString(),
    };

    res.setHeader("Cache-Control", "private, no-store, must-revalidate");
    res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取首页统计失败";
    res.status(500).json({ error: message });
  }
}
