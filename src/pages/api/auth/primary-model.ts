import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAuth } from "@server/auth/session";
import { updateUserPrimaryModel } from "@server/auth/userStore";

const payloadSchema = z.object({
  primaryModel: z
    .string()
    .trim()
    .min(1, "模型不能为空")
    .max(200, "模型名称过长"),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", ["PATCH"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "参数错误" });
    return;
  }

  const primaryModel = parsed.data.primaryModel;
  const updated = await updateUserPrimaryModel(String(auth.user._id), primaryModel);

  if (!updated) {
    res.status(500).json({ error: "更新失败，请稍后重试" });
    return;
  }

  res.status(200).json({
    success: true,
    primaryModel,
  });
}
