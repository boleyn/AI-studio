import type { Server } from "node:http";
import type { NextApiRequest, NextApiResponse } from "next";
import { getEmbeddedDeviceGateway } from "@/server/localDevice/socket";

export const config = { api: { bodyParser: { sizeLimit: "1kb" } } };

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const socket = res.socket as (typeof res.socket & { server?: Server; encrypted?: boolean }) | null;
  const server = socket?.server;
  if (!server) {
    res.status(503).json({ error: "local_device_http_server_unavailable" });
    return;
  }

  getEmbeddedDeviceGateway().attach(server);

  const secure = socket?.encrypted || req.headers["x-forwarded-proto"] === "https";
  const host = req.headers.host;
  if (!host) {
    res.status(400).json({ error: "local_device_host_required" });
    return;
  }

  const gatewayUrl = new URL("/local-device/connect", `${secure ? "wss" : "ws"}://${host}`).href;
  res.status(200).json({
    available: true,
    protocolVersion: 1,
    gatewayUrl,
  });
}
