import { parse } from "cookie";
import type { IncomingMessage } from "http";
import { verifyAuthToken } from "./jwt";

export const getAuthTokenFromRequest = (req?: IncomingMessage) => {
  if (!req?.headers?.cookie) return null;
  const parsed = parse(req.headers.cookie);
  return parsed.auth_token || null;
};

export const getAuthUserFromRequest = (req?: IncomingMessage) => {
  const token = getAuthTokenFromRequest(req);
  if (!token) return null;
  try {
    return verifyAuthToken(token);
  } catch {
    return null;
  }
};
