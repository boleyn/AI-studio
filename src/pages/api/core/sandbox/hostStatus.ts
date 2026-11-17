import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import {
  ensureUserCloudHostAllocated,
  getUserCloudHostStatus,
} from "@server/sandbox/userCloudHostManager";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const userId = String(auth.user._id);
  let session = getUserCloudHostStatus(userId);
  if (!session || session.status === "stopped" || session.status === "sleeping") {
    session = await ensureUserCloudHostAllocated(userId);
  }

  res.status(200).json({ host: session });
}
