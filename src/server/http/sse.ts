import type { NextApiResponse } from "next";

export const sendSseEvent = (res: NextApiResponse, event: string, data: string) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
  const streamRes = res as NextApiResponse & { flush?: () => void };
  streamRes.flush?.();
};

export const startSse = (res: NextApiResponse) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  const streamRes = res as NextApiResponse & { flushHeaders?: () => void };
  streamRes.flushHeaders?.();
};

export const startSseHeartbeat = (res: NextApiResponse, intervalMs = 15000) => {
  const timer = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
      const streamRes = res as NextApiResponse & { flush?: () => void };
      streamRes.flush?.();
    } catch {
      clearInterval(timer);
    }
  }, intervalMs);

  return () => clearInterval(timer);
};
