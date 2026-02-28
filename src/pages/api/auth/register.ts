import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { createUser, findUserByUsername } from "@server/auth/userStore";
import { hashPassword } from "@server/auth/password";
import { signAuthToken } from "@server/auth/jwt";
import { setAuthCookie } from "@server/auth/session";

const payloadSchema = z.object({
  username: z.string().min(3, "用户名至少 3 位"),
  password: z.string().min(6, "密码至少 6 位"),
  contact: z.string().optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const parseResult = payloadSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.issues[0]?.message || "参数错误" });
    return;
  }

  const { username, password, contact } = parseResult.data;

  const existing = await findUserByUsername(username);
  if (existing) {
    res.status(409).json({ error: "账号已存在" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const userId = await createUser({ username, passwordHash, contact, provider: "password" });

  const token = signAuthToken({ sub: String(userId), username });
  setAuthCookie(res, token);

  res.status(200).json({
    token,
    user: {
      id: String(userId),
      username,
      contact,
    },
  });
}
