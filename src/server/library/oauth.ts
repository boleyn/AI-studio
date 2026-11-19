import type { NextApiRequest, NextApiResponse } from "next";
import { createCipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { serialize } from "cookie";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";

type Provider = "google" | "dropbox";

export async function handleLibraryOAuth(provider: Provider, req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");
  const owner = String(auth.user._id);
  const google = provider === "google";
  const prefix = google ? "GOOGLE_DRIVE" : "DROPBOX";
  const clientId = process.env[prefix + "_CLIENT_ID"];
  const secret = process.env[prefix + "_CLIENT_SECRET"];
  const redirect = process.env[prefix + "_REDIRECT_URI"];
  const cookieName = "library_" + provider + "_state";
  const cookiePath = "/api/library/connectors/" + provider;
  const key = Buffer.from(process.env.LIBRARY_CONNECTOR_KEY || "", "base64");
  const configured = Boolean(clientId && secret && redirect && key.length === 32);
  const connections = (await getMongoDb()).collection<{ _id: string; token: string; canRename?: boolean }>(google ? "library_drive_connections" : "library_dropbox_connections");
  if (req.method === "GET" && req.query.status === "1") {
    return res.json({ configured, connected: Boolean(await connections.findOne({ _id: owner }, { projection: { _id: 1 } })) });
  }
  if (!configured || !clientId || !secret || !redirect) return res.status(503).json({ error: "尚未配置此文件服务的连接" });
  const cookie = (value: string, age: number) => serialize(cookieName, value, {
    httpOnly: true, sameSite: "lax", secure: redirect.startsWith("https:"), path: cookiePath, maxAge: age,
  });
  if (req.method === "POST") {
    const siteId = google ? req.body?.siteId : undefined;
    if (siteId !== undefined && (typeof siteId !== "string" || !/^[0-9a-f]{24}$/.test(siteId))) return res.status(400).end();
    const state = randomBytes(32).toString("hex") + (siteId ? "." + siteId : "");
    res.setHeader("Set-Cookie", cookie(owner + "." + state, 600));
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code",
      scope: google ? "https://www.googleapis.com/auth/drive.readonly" : "files.metadata.read files.content.read", state });
    if (google) {
      params.set("access_type", "offline");
      params.set("prompt", "consent");
      if (req.body?.allowRename === true) params.set("scope", params.get("scope") + " https://www.googleapis.com/auth/drive.metadata");
    } else {
      params.set("token_access_type", "offline");
    }
    const authorize = google ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://www.dropbox.com/oauth2/authorize";
    return res.json({ url: authorize + "?" + params });
  }
  if (req.method !== "GET") return res.setHeader("Allow", "GET, POST").status(405).end();
  const expected = Buffer.from(req.cookies[cookieName] || "");
  const provided = Buffer.from(owner + "." + req.query.state);
  let returnTo = "/?view=library&libraryConnectors=" + (google ? "" : "dropbox-");
  if (!expected.length || expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return res.redirect(303, returnTo + "invalid-session");
  }
  const siteId = typeof req.query.state === "string" && /^[a-f0-9]{64}\.([a-f0-9]{24})$/.exec(req.query.state)?.[1];
  if (siteId) returnTo = "/share/preview/" + siteId + "?libraryConnectors=";
  // A stale tab must not clear the state for a newer authorization attempt.
  res.setHeader("Set-Cookie", cookie("", 0));
  if (typeof req.query.code !== "string") return res.redirect(303, returnTo + (req.query.error === "access_denied" ? "cancelled" : "error"));
  try {
    const response = await fetch(google ? "https://oauth2.googleapis.com/token" : "https://api.dropboxapi.com/oauth2/token", { method: "POST", body: new URLSearchParams({
      client_id: clientId, client_secret: secret, code: req.query.code, grant_type: "authorization_code", redirect_uri: redirect,
    }) });
    const data = await response.json();
    if (!response.ok || typeof data.refresh_token !== "string") return res.redirect(303, returnTo + "error");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(google ? owner : provider + ":" + owner));
    const ciphertext = Buffer.concat([cipher.update(data.refresh_token, "utf8"), cipher.final()]);
    const token = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
    await connections.updateOne({ _id: owner }, { $set: { token, canRename: String(data.scope || "").split(" ").includes("https://www.googleapis.com/auth/drive.metadata") } }, { upsert: true });
    return res.redirect(303, returnTo + "connected");
  } catch {
    return res.redirect(303, returnTo + "error");
  }
}
