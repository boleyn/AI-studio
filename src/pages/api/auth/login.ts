import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { findUserByUsername } from "@server/auth/userStore";
import { verifyPassword } from "@server/auth/password";
import { signAuthToken } from "@server/auth/jwt";
import { setAuthCookie } from "@server/auth/session";

const payloadSchema = z.object({
  username: z.string().min(1, "请输入账号"),
  password: z.string().min(1, "请输入密码"),
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

  const { username, password } = parseResult.data;
  const user = await findUserByUsername(username);
  if (!user) {
    res.status(401).json({ error: "账号或密码错误" });
    return;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "账号或密码错误" });
    return;
  }

  const token = signAuthToken({ sub: String(user._id), username: user.username });
  setAuthCookie(res, token);

  res.status(200).json({
    token,
    user: {
      id: String(user._id),
      username: user.username,
      contact: user.contact,
    },
  });
}
