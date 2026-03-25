import { requireAuth } from "@server/auth/session";
import type { NextApiRequest, NextApiResponse } from "next";

type HubSortKey = "relevance" | "newest" | "updated" | "downloads" | "installs" | "stars" | "name";
type HubSortDir = "asc" | "desc";

const parseBoolean = (value: unknown) => {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
};

const parseSort = (value: unknown): HubSortKey => {
  if (
    value === "relevance" ||
    value === "newest" ||
    value === "updated" ||
    value === "downloads" ||
    value === "installs" ||
    value === "stars" ||
    value === "name"
  ) {
    return value;
  }
  return "downloads";
};

const parseDir = (value: unknown, sort: HubSortKey): HubSortDir => {
  if (value === "asc" || value === "desc") return value;
  return sort === "name" ? "asc" : "desc";
};

const parseNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed =
    typeof value === "string" ? Number.parseInt(value, 10) : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const parseString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

type HubBrowseResponse = {
  items?: HubBrowseItem[];
  total?: number;
  hasMore?: boolean;
};

type HubBrowseItem = {
  skill?: {
    slug?: string;
    displayName?: string;
    summary?: string | null;
    stats?: {
      downloads?: number;
      stars?: number;
    };
    createdAt?: number;
    updatedAt?: number;
    badges?: Record<string, unknown> | null;
  };
  ownerHandle?: string | null;
  latestVersion?: {
    llmAnalysis?: unknown;
    vtAnalysis?: unknown;
  };
};

const normalizeScanStatus = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
};

const hasSuspiciousScan = (analysis: unknown) => {
  if (!analysis || typeof analysis !== "object") return false;
  const raw = analysis as Record<string, unknown>;
  const status = normalizeScanStatus(raw.status);
  const verdict = normalizeScanStatus(raw.verdict);
  return status === "suspicious" || status === "malicious" || verdict === "suspicious" || verdict === "malicious";
};

const isSuspicious = (item: HubBrowseItem) => {
  const llm = item?.latestVersion?.llmAnalysis;
  const vt = item?.latestVersion?.vtAnalysis;
  return hasSuspiciousScan(llm) || hasSuspiciousScan(vt);
};

const isHighlighted = (item: HubBrowseItem) => {
  const badges = item?.skill?.badges;
  if (!badges || typeof badges !== "object") return false;
  return Object.prototype.hasOwnProperty.call(badges, "highlighted");
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const hubBase = process.env.SKILL_HUB?.trim();
  if (!hubBase) {
    res.status(500).json({ error: "SKILL_HUB 未配置" });
    return;
  }
  const proxySecret = process.env.SKILL_HUB_PROXY_SECRET?.trim();
  if (!proxySecret) {
    res.status(500).json({ error: "SKILL_HUB_PROXY_SECRET 未配置" });
    return;
  }

  const q = parseString(req.query.q);
  const sort = parseSort(parseString(req.query.sort));
  const dir = parseDir(parseString(req.query.dir), sort);
  const highlighted = parseBoolean(req.query.highlighted);
  const nonSuspicious = parseBoolean(req.query.nonSuspicious);
  const offset = parseNumber(req.query.offset, 0, 0, 10_000);
  const limit = parseNumber(req.query.limit, 25, 1, 50);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("sort", sort);
  params.set("dir", dir);
  if (highlighted) params.set("highlighted", "1");
  if (nonSuspicious) params.set("nonSuspicious", "1");
  params.set("offset", String(offset));
  params.set("limit", String(limit));

  const apiUrl = `${hubBase.replace(/\/+$/, "")}/api/v1/skills/browse?${params.toString()}`;

  try {
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-ClawHub-Proxy-Secret": proxySecret,
      },
    });

    const payload = (await response.json().catch(() => ({}))) as HubBrowseResponse;
    if (!response.ok) {
      const raw = payload as Record<string, unknown>;
      const statusMessage = typeof raw.statusMessage === "string" ? raw.statusMessage : "";
      res.status(response.status).json({
        error: statusMessage || `读取 ClawHub 技能列表失败（${response.status}）`,
      });
      return;
    }

    const items = Array.isArray((payload as HubBrowseResponse).items)
      ? ((payload as HubBrowseResponse).items || []).map((item) => ({
          slug: item?.skill?.slug || "",
          displayName: item?.skill?.displayName || item?.skill?.slug || "",
          summary: item?.skill?.summary || "",
          ownerHandle: item?.ownerHandle || "",
          downloads: Number(item?.skill?.stats?.downloads || 0),
          stars: Number(item?.skill?.stats?.stars || 0),
          createdAt: Number(item?.skill?.createdAt || 0),
          updatedAt: Number(item?.skill?.updatedAt || 0),
          highlighted: isHighlighted(item),
          suspicious: isSuspicious(item),
        }))
      : [];

    res.status(200).json({
      ok: true,
      q,
      sort,
      dir,
      highlighted,
      nonSuspicious,
      offset,
      limit,
      total: Number((payload as HubBrowseResponse).total || 0),
      hasMore: Boolean((payload as HubBrowseResponse).hasMore),
      items,
    });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "读取 ClawHub 技能列表失败",
    });
  }
}
