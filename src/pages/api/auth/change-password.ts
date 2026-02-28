import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { verifyPassword, hashPassword } from "@server/auth/password";
import { updateUserPassword } from "@server/auth/userStore";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: "仅支持 POST" });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (auth.user.provider !== "password") {
    res.status(400).json({ error: "飞书登录用户无法在此修改密码" });
    return;
  }

  const { oldPassword, newPassword } = req.body ?? {};
  if (!oldPassword || !newPassword) {
    res.status(400).json({ error: "请填写原密码和新密码" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "新密码至少 6 位" });
    return;
  }

  const ok = await verifyPassword(oldPassword, auth.user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "原密码错误" });
    return;
  }

  const newHash = await hashPassword(newPassword);
  const updated = await updateUserPassword(String(auth.user._id), newHash);
  if (!updated) {
    res.status(500).json({ error: "更新失败" });
    return;
  }

  res.status(200).json({ success: true });
}
