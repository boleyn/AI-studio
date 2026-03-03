import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { findUserByUsername, createUser, updateUserProfile } from "@server/auth/userStore";
import { hashPassword } from "@server/auth/password";
import { signAuthToken } from "@server/auth/jwt";
import { setAuthCookie } from "@server/auth/session";

const DEFAULT_AVATAR = "/icons/defaultAvatar.svg";

const payloadSchema = z.object({
  code: z.string().min(1, "缺少 code"),
});

const maskValue = (value: unknown) => {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return "";
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
};

const debugLog = (label: string, data: Record<string, unknown>) => {
  console.info(`[feishu-login] ${label}`, data);
};

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
  debugLog("received_callback_code", {
    hasCode: Boolean(code),
    codePreview: maskValue(code),
  });

  const accessToken =
    (await requestPassportToken(appId, appSecret, code)) ||
    (await requestOpenApiToken(appId, appSecret, code));

  if (!accessToken) {
    res.status(500).json({ error: "飞书授权失败" });
    return;
  }

  const feishuUser = await fetchFeishuUser(accessToken);
  debugLog("user_info_response", {
    hasUser: Boolean(feishuUser),
    keys: feishuUser ? Object.keys(feishuUser) : [],
    name: feishuUser?.name || "",
    en_name: feishuUser?.en_name || "",
    email: feishuUser?.email || "",
    enterprise_email: feishuUser?.enterprise_email || "",
    mobile: feishuUser?.mobile || "",
    avatar_url: feishuUser?.avatar_url || "",
    avatar_big_url: feishuUser?.avatar_big_url || "",
    avatar_thumb: feishuUser?.avatar_thumb || "",
    union_id: feishuUser?.union_id || "",
    open_id: feishuUser?.open_id || "",
  });
  if (!feishuUser) {
    res.status(500).json({ error: "获取飞书用户信息失败" });
    return;
  }

  const displayName: string = feishuUser.name || feishuUser.en_name || "";
  const email: string = feishuUser.email || feishuUser.enterprise_email || "";
  const phoneRaw: string = feishuUser.mobile || "";
  const avatarFromFeishu: string =
    feishuUser.avatar_url || feishuUser.avatar_big_url || feishuUser.avatar_thumb || "";
  const digits = String(phoneRaw).replace(/\D/g, "");
  const phone = digits.length >= 11 ? digits.slice(-11) : "";

  const username = phone || email;
  debugLog("normalized_user_fields", {
    displayName,
    emailMasked: maskValue(email),
    phoneMasked: maskValue(phone),
    avatarMasked: maskValue(avatarFromFeishu),
    hasUsername: Boolean(username),
  });
  if (!username) {
    console.warn("[feishu-login] missing_username_source", {
      reason: "no mobile/email in feishu user info",
      email: feishuUser?.email || feishuUser?.enterprise_email || "",
      mobile: feishuUser?.mobile || "",
      union_id: feishuUser?.union_id || "",
      open_id: feishuUser?.open_id || "",
    });
    res.status(400).json({ error: "飞书账号缺少手机号或邮箱" });
    return;
  }

  let user = await findUserByUsername(username);
  const nextContact = phone || email || displayName || username;
  const nextAvatar = avatarFromFeishu || DEFAULT_AVATAR;
  if (!user) {
    const passwordHash = await hashPassword(defaultPassword);
    const userId = await createUser({
      username,
      passwordHash,
      contact: nextContact,
      avatar: nextAvatar,
      provider: "feishu",
    });
    user = {
      _id: userId,
      username,
      passwordHash,
      contact: nextContact,
      avatar: nextAvatar,
      provider: "feishu",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } else {
    const shouldPatchContact = !user.contact && Boolean(nextContact);
    const shouldPatchAvatar = !user.avatar && Boolean(nextAvatar);
    if (shouldPatchContact || shouldPatchAvatar) {
      await updateUserProfile(String(user._id), {
        contact: shouldPatchContact ? nextContact : undefined,
        avatar: shouldPatchAvatar ? nextAvatar : undefined,
      });
      user = {
        ...user,
        contact: shouldPatchContact ? nextContact : user.contact,
        avatar: shouldPatchAvatar ? nextAvatar : user.avatar,
      };
    }
  }

  const token = signAuthToken({ sub: String(user._id), username: user.username });
  setAuthCookie(res, token);

  res.status(200).json({
    token,
    user: {
      id: String(user._id),
      username: user.username,
      contact: user.contact,
      avatar: user.avatar || DEFAULT_AVATAR,
      provider: user.provider ?? "feishu",
    },
  });
}
