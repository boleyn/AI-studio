import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("X-AIStudio-Deprecated", "true");
  res.setHeader("X-AIStudio-Replacement", "/api/v2/chat/completions");
  res.status(410).json({
    error:
      "Deprecated endpoint. Skills chat completions now use /api/v2/chat/completions with the unified session protocol.",
  });
}
