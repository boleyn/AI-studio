import type { NextApiRequest, NextApiResponse } from "next";
import { serialize } from "cookie";
import { verifyAuthToken } from "./jwt";
import { findUserById } from "./userStore";

const shouldUseSecureCookie = () => {
  const secureEnv = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (secureEnv === "true") return true;
  if (secureEnv === "false") return false;
  return process.env.NODE_ENV === "production";
};

export const getAuthTokenFromRequest = (req: NextApiRequest) => {
  const cookieToken = req.cookies?.auth_token;
  if (cookieToken) return cookieToken;

  const header = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  if (header.startsWith("Bearer ")) {
    return header.replace("Bearer ", "").trim();
  }
  const headerToken = typeof req.headers["x-auth-token"] === "string" ? req.headers["x-auth-token"] : null;
  if (headerToken) return headerToken;
  const legacyToken = typeof req.headers["token"] === "string" ? req.headers["token"] : null;
  if (legacyToken) return legacyToken;
  return null;
};

export const requireAuth = async (req: NextApiRequest, res: NextApiResponse) => {
  const token = getAuthTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: "未登录或凭证失效" });
    return null;
  }

  try {
    const payload = verifyAuthToken(token);
    const user = await findUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: "用户不存在" });
      return null;
    }
    return { token, user };
  } catch (error) {
    res.status(401).json({ error: "登录已过期，请重新登录" });
    return null;
  }
};

export const setAuthCookie = (res: NextApiResponse, token: string) => {
  const secure = shouldUseSecureCookie();
  const cookie = serialize("auth_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  res.setHeader("Set-Cookie", cookie);
};

export const clearAuthCookie = (res: NextApiResponse) => {
  const secure = shouldUseSecureCookie();
  const cookie = serialize("auth_token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  res.setHeader("Set-Cookie", cookie);
};
