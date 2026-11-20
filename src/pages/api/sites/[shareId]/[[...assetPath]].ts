import fs from "node:fs/promises";
import path from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";

import { getAuthUserFromRequest } from "@server/auth/ssr";
import { canViewRestrictedSite, getSiteSettings } from "@server/library/sites";
import { getProject } from "@server/projects/projectStorage";
import { getShareLink } from "@server/shares/shareStorage";
import {
  ensureStaticSiteBuilt,
  renderBuildErrorHtml,
} from "@server/shares/staticSiteBuilder";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function mimeForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", ["GET", "HEAD"]);
    res.status(405).end();
    return;
  }

  const shareId = typeof req.query.shareId === "string" ? req.query.shareId.trim() : "";
  if (!/^[a-zA-Z0-9_-]{4,128}$/.test(shareId)) {
    res.status(404).end();
    return;
  }

  const share = await getShareLink(shareId);
  if (!share || share.mode !== "preview") {
    res.status(404).end();
    return;
  }

  const settings = await getSiteSettings(share.ownerUserId, share.projectToken);
  if (settings?.restricted) {
    const userId = getAuthUserFromRequest(req)?.sub;
    if (!userId) {
      res.status(401).send("Unauthorized");
      return;
    }
    const allowed = await canViewRestrictedSite(share.ownerUserId, share.projectToken, userId);
    if (!allowed) {
      res.status(403).send("Forbidden");
      return;
    }
  }

  const project = await getProject(share.projectToken);
  if (!project) {
    res.status(404).end();
    return;
  }

  const build = await ensureStaticSiteBuilt(shareId, project);
  if (!build.ok) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(renderBuildErrorHtml(settings?.name || project.name, build.errors));
    return;
  }

  const rawSegments = Array.isArray(req.query.assetPath)
    ? req.query.assetPath
    : typeof req.query.assetPath === "string"
      ? [req.query.assetPath]
      : [];
  const relative = rawSegments.length > 0 ? rawSegments.join("/") : "index.html";

  if (relative === "build-meta.json" || relative.includes("..")) {
    res.status(404).end();
    return;
  }

  let targetPath = path.resolve(build.outputDir, relative);
  if (!targetPath.startsWith(build.outputDir + path.sep)) {
    res.status(404).end();
    return;
  }

  try {
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) {
      targetPath = path.join(targetPath, "index.html");
    }
  } catch {
    // SPA fallback for extensionless routes
    if (!path.extname(relative)) {
      targetPath = path.join(build.outputDir, "index.html");
    } else {
      res.status(404).end();
      return;
    }
  }

  try {
    const content = await fs.readFile(targetPath);
    res.setHeader("Content-Type", mimeForFile(targetPath));
    res.setHeader("Cache-Control", "private, no-cache");
    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }
    res.status(200).send(content);
  } catch {
    res.status(404).end();
  }
}
