import type { NextApiRequest, NextApiResponse } from "next";
import { clearAuthCookie } from "@server/auth/session";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }
  clearAuthCookie(res);
  res.status(200).json({ ok: true });
}
