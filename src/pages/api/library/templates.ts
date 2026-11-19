import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { getMongoDb } from "@server/db/mongo";
import { workbookTemplates } from "@/types/libraryWorkbookTemplates";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "DELETE") {
    return res.setHeader("Allow", "GET, DELETE").status(405).end();
  }
  const auth = await requireAuth(req, res);
  if (!auth) return;
  res.setHeader("Cache-Control", "private, no-store");
  const owner = String(auth.user._id);
  const db = await getMongoDb();
  const settings = db.collection<{_id:string; removed:string[]}>("library_template_preferences");
  if (req.method === "GET") {
    const preference = await settings.findOne({_id:owner});
    return res.json(preference?.removed ?? []);
  }
  const name = req.body?.name;
  if (!workbookTemplates.some(template => template.name === name)) return res.status(400).end();
  await settings.updateOne({_id:owner}, {$addToSet:{removed:name}}, {upsert:true});
  return res.status(204).end();
}
