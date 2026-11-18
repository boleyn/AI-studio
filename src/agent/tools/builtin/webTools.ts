import TurndownService from "turndown";
import { defineTool } from "../types";

const MAX_FETCH_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
turndown.remove(["script", "style", "noscript"]);

const isBlockedHost = (hostname: string): boolean => {
  const lower = hostname.toLowerCase();
  return (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "0.0.0.0" ||
    lower === "::1" ||
    lower.endsWith(".local") ||
    lower === "169.254.169.254"
  );
};

export const WebFetchTool = defineTool<{ url: string; prompt?: string }>({
  name: "WebFetch",
  toolset: "web",
  readOnly: true,
  description: "Fetch a public HTTP/HTTPS URL and extract readable text/Markdown content.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Public http(s) URL to fetch" },
      prompt: { type: "string", description: "Optional focus hint for what to look for" },
    },
    required: ["url"],
  },
  async handler(input, { signal }) {
    let parsed: URL;
    try {
      parsed = new URL(String(input.url || "").trim());
    } catch {
      return { content: `Invalid URL: ${input.url}`, isError: true };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { content: `Unsupported protocol: ${parsed.protocol}`, isError: true };
    }
    if (isBlockedHost(parsed.hostname)) {
      return { content: `Refusing to fetch private/local host: ${parsed.hostname}`, isError: true };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: { "user-agent": "AIStudio-HermesAgent/1.0" },
      });
      if (!response.ok) {
        return { content: `HTTP ${response.status} ${response.statusText}`, isError: true };
      }
      const contentType = response.headers.get("content-type") || "";
      const reader = response.body?.getReader();
      if (!reader) return { content: "Empty response body" };
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > MAX_FETCH_BYTES) { await reader.cancel(); return { content: "Response exceeds 8 MiB retrieval limit. Use a narrower endpoint or range request.", isError: true }; }
        chunks.push(chunk.value);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = contentType.includes("html") ? turndown.turndown(raw) : raw;
      return { content: `URL: ${parsed.toString()}\n\n${body}` };
    } catch (error) {
      return { content: `WebFetch error: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  },
});

export const WebSearchTool = defineTool<{ query: string }>({
  name: "WebSearch",
  toolset: "web",
  readOnly: true,
  isAvailable: () => Boolean((process.env.WEB_SEARCH_API_URL || "").trim()),
  description: "Search the web using the configured search endpoint (WEB_SEARCH_API_URL).",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  async handler(input, { signal }) {
    const endpoint = (process.env.WEB_SEARCH_API_URL || "").trim();
    if (!endpoint) return { content: "WebSearch is not configured (WEB_SEARCH_API_URL is unset).", isError: true };
    const apiKey = (process.env.WEB_SEARCH_API_KEY || "").trim();
    const response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ query: String(input.query || "") }),
    });
    if (!response.ok) return { content: `WebSearch HTTP ${response.status}`, isError: true };
    const data = await response.json();
    return { content: typeof data === "string" ? data : JSON.stringify(data, null, 2) };
  },
});
