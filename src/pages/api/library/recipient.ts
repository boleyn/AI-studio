import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { findSpaceInviteRecipient } from "@server/auth/userStore";

export default async function handler(req:NextApiRequest,res:NextApiResponse) {
  const auth = await requireAuth(req,res);
  if (!auth) return;
  res.setHeader("Cache-Control","private, no-store");
  if (req.method !== "GET") return res.setHeader("Allow","GET").status(405).end();
  const account = req.query.account;
  if (typeof account !== "string" || !account.trim() || account.length > 103) return res.status(400).end();
  const user = await findSpaceInviteRecipient(account.trim());
  res.json({recipient:user && String(user._id)!==String(auth.user._id) ? {name:user.displayName || user.username} : null});
}
