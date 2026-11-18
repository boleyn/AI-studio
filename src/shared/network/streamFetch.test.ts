import { expect, test } from "bun:test";
import { streamFetch } from "./streamFetch";

test("SSE failures reject once instead of becoming blank successful replies or retrying", async () => {
  let calls = 0;
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() {
    calls++;
    return new Response('event: error\ndata: {"message":"model unavailable"}\n\n', { headers: { "content-type": "text/event-stream" } });
  } });
  const priorFrame = globalThis.requestAnimationFrame;
  const priorDocument = globalThis.document;
  const frames: Array<ReturnType<typeof setTimeout>> = [];
  globalThis.requestAnimationFrame = (callback) => {
    const timer = setTimeout(() => callback(performance.now()), 1);
    frames.push(timer);
    return Number(timer);
  };
  globalThis.document = { hidden: false } as Document;
  try {
    await expect(streamFetch({ url: `http://127.0.0.1:${server.port}`, data: {}, onMessage() {}, abortCtrl: new AbortController() })).rejects.toThrow("model unavailable");
    expect(calls).toBe(1);
  } finally {
    frames.forEach(clearTimeout);
    globalThis.requestAnimationFrame = priorFrame;
    globalThis.document = priorDocument;
    server.stop(true);
  }
});
