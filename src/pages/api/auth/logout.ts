import type { NextApiRequest, NextApiResponse } from "next";
import { clearAuthCookie, getAuthTokenFromRequest } from "@server/auth/session";
import { verifyAuthToken } from "@server/auth/jwt";
import { releaseUserCloudHost } from "@server/sandbox/userCloudHostManager";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const token = getAuthTokenFromRequest(req);
  if (token) {
    try {
      const payload = verifyAuthToken(token);
      if (payload?.sub) {
        await releaseUserCloudHost(String(payload.sub), "logout");
      }
    } catch {
      // ignore invalid/expired token during logout
    }
  }

  clearAuthCookie(res);
  res.status(200).json({ ok: true });
}
