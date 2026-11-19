import type { NextApiRequest, NextApiResponse } from "next";
import { createCipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { serialize } from "cookie";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";

const cookieName = "library_google_state";
const cookiePath = "/api/library/connectors/google";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");
  const owner = String(auth.user._id);
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const secret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const redirect = process.env.GOOGLE_DRIVE_REDIRECT_URI;
  const key = Buffer.from(process.env.LIBRARY_CONNECTOR_KEY || "", "base64");
  const configured = Boolean(clientId && secret && redirect && key.length === 32);
  const connections = (await getMongoDb()).collection<{ _id: string; token: string; canRename?: boolean }>("library_drive_connections");
  if (req.method === "GET" && req.query.status === "1") {
    return res.json({ configured, connected: Boolean(await connections.findOne({ _id: owner }, { projection: { _id: 1 } })) });
  }
  if (!configured || !clientId || !secret || !redirect) return res.status(503).json({ error: "尚未配置 Google Drive 连接" });
  const cookie = (value: string, age: number) => serialize(cookieName, value, {
    httpOnly: true, sameSite: "lax", secure: redirect.startsWith("https:"), path: cookiePath, maxAge: age,
  });
  if (req.method === "POST") {
    const state = randomBytes(32).toString("hex");
    res.setHeader("Set-Cookie", cookie(owner + "." + state, 600));
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code",
      scope: req.body?.allowRename === true ? "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.metadata" : "https://www.googleapis.com/auth/drive.readonly", access_type: "offline", prompt: "consent", state });
    return res.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?" + params });
  }
  if (req.method !== "GET") return res.setHeader("Allow", "GET, POST").status(405).end();
  const expected = Buffer.from(req.cookies[cookieName] || "");
  const provided = Buffer.from(owner + "." + req.query.state);
  res.setHeader("Set-Cookie", cookie("", 0));
  const returnTo = "/?view=library&libraryConnectors=";
  if (!expected.length || expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return res.redirect(303, returnTo + "invalid-session");
  }
  if (typeof req.query.code !== "string") return res.redirect(303, returnTo + (req.query.error === "access_denied" ? "cancelled" : "error"));
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({
      client_id: clientId, client_secret: secret, code: req.query.code, grant_type: "authorization_code", redirect_uri: redirect,
    }) });
    const data = await response.json();
    if (!response.ok || typeof data.refresh_token !== "string") return res.redirect(303, returnTo + "error");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(owner));
    const ciphertext = Buffer.concat([cipher.update(data.refresh_token, "utf8"), cipher.final()]);
    const token = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
    await connections.updateOne({ _id: owner }, { $set: { token, canRename: String(data.scope || "").split(" ").includes("https://www.googleapis.com/auth/drive.metadata") } }, { upsert: true });
    return res.redirect(303, returnTo + "connected");
  } catch {
    return res.redirect(303, returnTo + "error");
  }
}
