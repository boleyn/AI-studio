import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  res.status(200).json({
    user: {
      id: String(auth.user._id),
      username: auth.user.username,
      contact: auth.user.contact,
      provider: auth.user.provider ?? "password",
    },
  });
}
