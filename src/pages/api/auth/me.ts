import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import {
  ensureUserCloudHostAllocated,
  getUserCloudHostStatus,
  touchUserCloudHost,
} from "@server/sandbox/userCloudHostManager";

const DEFAULT_AVATAR = "/icons/defaultAvatar.svg";
const sanitizeAvatar = (avatar?: string) => {
  const raw = (avatar || "").trim();
  if (!raw) return DEFAULT_AVATAR;
  if (/^data:image\//i.test(raw)) return DEFAULT_AVATAR;
  return raw;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const userId = String(auth.user._id);
  const hostStatus = getUserCloudHostStatus(userId);
  if (!hostStatus || hostStatus.status === "stopped" || hostStatus.status === "sleeping") {
    void ensureUserCloudHostAllocated(userId);
  } else {
    touchUserCloudHost(userId);
  }

  res.status(200).json({
    user: {
      id: String(auth.user._id),
      username: auth.user.username,
      displayName: auth.user.displayName || auth.user.username,
      contact: auth.user.contact,
      avatar: sanitizeAvatar(auth.user.avatar),
      primaryModel: auth.user.primaryModel,
      provider: auth.user.provider ?? "password",
    },
  });
}
