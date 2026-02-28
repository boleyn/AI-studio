import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { findUserByUsername, createUser } from "@server/auth/userStore";
import { hashPassword } from "@server/auth/password";
import { signAuthToken } from "@server/auth/jwt";
import { setAuthCookie } from "@server/auth/session";

const payloadSchema = z.object({
  code: z.string().min(1, "缺少 code"),
});

const getFeishuConfig = () => ({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  redirectUri: process.env.FEISHU_REDIRECT_URI,
  defaultPassword: process.env.FEISHU_DEFAULT_PASSWORD || "Feishu@123456",
});

const requestPassportToken = async (appId: string, appSecret: string, code: string) => {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: appId,
    client_secret: appSecret,
    code,
  });
  const response = await fetch(
    `https://passport.feishu.cn/suite/passport/oauth/token?${params.toString()}`,
    { method: "POST" }
  );
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as any;
  return data?.access_token || data?.data?.access_token || null;
};

const requestOpenApiToken = async (appId: string, appSecret: string, code: string) => {
  const response = await fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      client_id: appId,
      client_secret: appSecret,
    }),
  });
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as any;
  return data?.access_token || data?.data?.access_token || null;
};

const fetchFeishuUser = async (accessToken: string) => {
  const response = await fetch("https://open.feishu.cn/open-apis/authen/v1/user_info", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = (await response.json().catch(() => null)) as any;
  return payload?.data || null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
  const parseResult = payloadSchema.safeParse(body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.issues[0]?.message || "参数错误" });
    return;
  }

  const { appId, appSecret, defaultPassword } = getFeishuConfig();
  if (!appId || !appSecret) {
    res.status(500).json({ error: "未配置飞书登录参数" });
    return;
  }

  const { code } = parseResult.data;
  const accessToken =
    (await requestPassportToken(appId, appSecret, code)) ||
    (await requestOpenApiToken(appId, appSecret, code));

  if (!accessToken) {
    res.status(500).json({ error: "飞书授权失败" });
    return;
  }

  const feishuUser = await fetchFeishuUser(accessToken);
  if (!feishuUser) {
    res.status(500).json({ error: "获取飞书用户信息失败" });
    return;
  }

  const displayName: string = feishuUser.name || feishuUser.en_name || "";
  const email: string = feishuUser.email || feishuUser.enterprise_email || "";
  const phoneRaw: string = feishuUser.mobile || "";
  const digits = String(phoneRaw).replace(/\D/g, "");
  const phone = digits.length >= 11 ? digits.slice(-11) : "";

  const username = phone || email;
  if (!username) {
    res.status(400).json({ error: "飞书账号缺少手机号或邮箱" });
    return;
  }

  let user = await findUserByUsername(username);
  if (!user) {
    const passwordHash = await hashPassword(defaultPassword);
    const userId = await createUser({
      username,
      passwordHash,
      contact: phone || email || displayName || username,
      provider: "feishu",
    });
    user = {
      _id: userId,
      username,
      passwordHash,
      contact: phone || email || displayName || username,
      provider: "feishu",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  const token = signAuthToken({ sub: String(user._id), username: user.username });
  setAuthCookie(res, token);

  res.status(200).json({
    token,
    user: {
      id: String(user._id),
      username: user.username,
      contact: user.contact,
      provider: user.provider ?? "feishu",
    },
  });
}
