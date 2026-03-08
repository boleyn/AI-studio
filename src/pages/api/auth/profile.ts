import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAuth } from "@server/auth/session";
import { updateUserProfile } from "@server/auth/userStore";

const DEFAULT_AVATAR = "/icons/defaultAvatar.svg";

const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "名称不能为空")
    .max(40, "名称最多 40 个字符"),
  avatar: z
    .string()
    .trim()
    .max(4096, "头像地址过长")
    .optional()
    .default(DEFAULT_AVATAR),
});

const isValidAvatar = (value: string) => {
  if (!value) return false;
  if (value.startsWith("/")) return true;
  if (/^https?:\/\//i.test(value)) return true;
  return false;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", ["PATCH"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "参数错误" });
    return;
  }

  const displayName = parsed.data.displayName;
  const avatar = parsed.data.avatar || DEFAULT_AVATAR;
  if (!isValidAvatar(avatar)) {
    res.status(400).json({ error: "头像地址仅支持站内路径或 http(s) 地址" });
    return;
  }

  const updated = await updateUserProfile(String(auth.user._id), {
    displayName,
    avatar,
  });

  if (!updated) {
    res.status(500).json({ error: "更新失败，请稍后重试" });
    return;
  }

  res.status(200).json({
    success: true,
    user: {
      id: String(auth.user._id),
      username: auth.user.username,
      displayName,
      contact: auth.user.contact,
      avatar,
      provider: auth.user.provider ?? "password",
    },
  });
}
