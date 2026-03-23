import { requireAuth } from "@server/auth/session";
import type { NextApiRequest, NextApiResponse } from "next";

type HubSkillDetailPayload = {
  skill?: {
    slug?: string;
    displayName?: string;
    summary?: string | null;
    ownerUserId?: string;
    stats?: {
      downloads?: number;
      stars?: number;
      versions?: number;
    };
    createdAt?: number;
    updatedAt?: number;
    badges?: Record<string, unknown> | null;
  };
  owner?: {
    handle?: string | null;
    displayName?: string | null;
    name?: string | null;
  } | null;
  latestVersion?: {
    version?: string;
    changelog?: string;
    readmePath?: string | null;
    readmeText?: string | null;
    files?: Array<{ path?: string; size?: number }>;
    vtAnalysis?: unknown;
    llmAnalysis?: unknown;
  };
};

const MAX_INLINE_FILE_BYTES = 512 * 1024;

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

const isHighlighted = (badges: unknown) => {
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

  const slugRaw = req.query.slug;
  const slug = Array.isArray(slugRaw)
    ? (slugRaw[0] || "").trim().toLowerCase()
    : typeof slugRaw === "string"
    ? slugRaw.trim().toLowerCase()
    : "";
  if (!slug) {
    res.status(400).json({ error: "缺少 slug" });
    return;
  }

  const hubBase = process.env.SKILL_HUB?.trim();
  if (!hubBase) {
    res.status(500).json({ error: "SKILL_HUB 未配置" });
    return;
  }

  const token = process.env.SKILL_TOKEN?.trim();
  const apiUrl = `${hubBase.replace(/\/+$/, "")}/api/v1/skills/${encodeURIComponent(slug)}`;

  try {
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const payload = (await response.json().catch(() => ({}))) as HubSkillDetailPayload;
    if (!response.ok) {
      const raw = payload as Record<string, unknown>;
      const statusMessage = typeof raw.statusMessage === "string" ? raw.statusMessage : "";
      res.status(response.status).json({
        error: statusMessage || `读取 ClawHub 技能详情失败（${response.status}）`,
      });
      return;
    }

    const highlighted = isHighlighted(payload.skill?.badges);
    const suspicious =
      hasSuspiciousScan(payload.latestVersion?.llmAnalysis) || hasSuspiciousScan(payload.latestVersion?.vtAnalysis);
    const fileEntries = Array.isArray(payload.latestVersion?.files)
      ? payload.latestVersion?.files
          .map((item) => ({
            path: typeof item?.path === "string" ? item.path.trim() : "",
            size: typeof item?.size === "number" ? item.size : 0,
          }))
          .filter((item) => Boolean(item.path))
      : [];
    const files = fileEntries.map((item) => item.path);
    const fileCount = files.length;
    const fileContents: Record<string, string> = {};

    if (files.length > 0) {
      await Promise.all(
        fileEntries.map(async (item) => {
          if (item.size > MAX_INLINE_FILE_BYTES) {
            fileContents[item.path] = `[文件过大，已跳过预览：${item.size} bytes]`;
            return;
          }
          const downloadUrl =
            `${hubBase.replace(/\/+$/, "")}/api/v1/download?namespace=skills` +
            `&slug=${encodeURIComponent(slug)}` +
            `&version=${encodeURIComponent(payload.latestVersion?.version || "")}` +
            `&path=${encodeURIComponent(item.path)}`;
          try {
            const fileResp = await fetch(downloadUrl, {
              method: "GET",
              headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
            });
            if (!fileResp.ok) {
              fileContents[item.path] = "";
              return;
            }
            const buf = await fileResp.arrayBuffer();
            fileContents[item.path] = new TextDecoder("utf-8").decode(buf);
          } catch {
            fileContents[item.path] = "";
          }
        })
      );
    }

    res.status(200).json({
      ok: true,
      slug: payload.skill?.slug || slug,
      displayName: payload.skill?.displayName || payload.skill?.slug || slug,
      summary: payload.skill?.summary || "",
      ownerHandle: payload.owner?.handle || payload.skill?.ownerUserId || "",
      ownerDisplayName: payload.owner?.displayName || payload.owner?.name || "",
      downloads: Number(payload.skill?.stats?.downloads || 0),
      stars: Number(payload.skill?.stats?.stars || 0),
      versions: Number(payload.skill?.stats?.versions || 0),
      createdAt: Number(payload.skill?.createdAt || 0),
      updatedAt: Number(payload.skill?.updatedAt || 0),
      highlighted,
      suspicious,
      latestVersion: {
        version: payload.latestVersion?.version || "",
        changelog: payload.latestVersion?.changelog || "",
        readmePath: payload.latestVersion?.readmePath || "",
        readmeText: payload.latestVersion?.readmeText || "",
        fileCount,
        files,
        fileContents,
      },
    });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "读取 ClawHub 技能详情失败",
    });
  }
}
