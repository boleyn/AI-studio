import type { NextApiRequest, NextApiResponse } from "next";

const FEISHU_AUTHORIZE_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";

const normalizeReturnTo = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
};

const normalizeRelay = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  try {
    const decoded = decodeURIComponent(raw);
    const url = new URL(decoded);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
};

const getCallbackUrl = (redirectUri: string, returnTo: string, ccRelay: string) => {
  const normalized = redirectUri.trim();
  if (!normalized) return "";
  try {
    const callback = new URL(normalized);
    callback.searchParams.set("returnTo", returnTo);
    if (ccRelay) {
      callback.searchParams.set("ccRelay", ccRelay);
    }
    return callback.toString();
  } catch {
    return "";
  }
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const appId = process.env.FEISHU_APP_ID?.trim() || "";
  const redirectUri = process.env.FEISHU_REDIRECT_URI?.trim() || "";
  const returnTo = normalizeReturnTo(req.query.lastRoute ?? req.query.returnTo);
  const ccRelay = normalizeRelay(req.query.ccRelay);
  const callbackUrl = getCallbackUrl(redirectUri, returnTo, ccRelay);

  if (!appId || !callbackUrl) {
    res.status(500).json({ error: "飞书登录未配置" });
    return;
  }

  const authUrl = new URL(FEISHU_AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("state", "STATE");
  res.redirect(302, authUrl.toString());
}
