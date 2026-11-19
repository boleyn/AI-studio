import type { NextApiRequest, NextApiResponse } from "next";
import { handleLibraryOAuth } from "@server/library/oauth";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return handleLibraryOAuth("sharepoint", req, res);
}
