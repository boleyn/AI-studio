import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("X-AIStudio-Deprecated", "true");
  res.setHeader("X-AIStudio-Replacement", "/api/v2/chat/completions");
  res.status(410).json({
    error:
      "Deprecated endpoint. This route has been removed after session-runtime protocol migration. Use /api/v2/chat/completions.",
  });
}
