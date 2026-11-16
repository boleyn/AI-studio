import type { NextApiRequest, NextApiResponse } from "next";
import { requireAuth } from "@server/auth/session";
import { CONNECTOR_PROTOCOL_VERSION, ConnectorClient } from "@/agent/sandbox/environments/connector";

/**
 * 探测用户本机挂载的连接器（projects/agent-connector）是否在线且认证通过。
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) return;

  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : undefined;
  if (!url) {
    res.status(400).json({ ok: false, error: "connector url is required" });
    return;
  }

  try {
    const client = new ConnectorClient(url, token);
    const stat = await client.call("stat", { path: "/" });
    res.status(200).json({
      ok: true,
      protocolVersion: CONNECTOR_PROTOCOL_VERSION,
      rootExists: Boolean(stat.exists),
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
