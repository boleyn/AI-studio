/**
 * AI Studio 本机连接器：把本机目录挂载为 Agent 工作空间。
 *
 *   AISTUDIO_CONNECTOR_ROOT=~/code/my-project \
 *   AISTUDIO_CONNECTOR_TOKEN=xxxx \
 *   bun projects/agent-connector/server.ts
 *
 * 服务端以 sandbox kind = "connector" 连接（见 src/agent/sandbox/environments/connector.ts）。
 * 所有路径都限制在 ROOT 内；命令在 ROOT 下以当前用户身份执行，请只挂载可信目录。
 */
import http from "node:http";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1;
const PORT = Number(process.env.AISTUDIO_CONNECTOR_PORT || 8787);
const ROOT = path.resolve((process.env.AISTUDIO_CONNECTOR_ROOT || process.cwd()).replace(/^~/, process.env.HOME || "~"));
const TOKEN = (process.env.AISTUDIO_CONNECTOR_TOKEN || "").trim();
const ALLOW_EXEC = (process.env.AISTUDIO_CONNECTOR_ALLOW_EXEC || "true").toLowerCase() !== "false";

if (!TOKEN) throw new Error("AISTUDIO_CONNECTOR_TOKEN is required");

const resolveInside = (virtualPath: unknown): string => {
  const raw = String(virtualPath || "/").replace(/\\/g, "/");
  const rel = path.posix.normalize(raw.startsWith("/") ? raw : `/${raw}`).slice(1);
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(`${ROOT}${path.sep}`)) throw new Error("path_outside_root");
  return abs;
};

const authorized = (req: http.IncomingMessage) => {
  const provided = Buffer.from(String(req.headers["x-aistudio-connector-token"] || ""));
  const expected = Buffer.from(TOKEN);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
};

const readBody = async (req: http.IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
};

const exec = (command: string, cwd: string, timeoutMs: number) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.env.SHELL || "/bin/bash", ["-lc", command], { cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), Math.max(1000, timeoutMs));
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
  });

const handlers: Record<string, (body: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  async read(body) {
    return { contentBase64: (await fsp.readFile(resolveInside(body.path))).toString("base64") };
  },
  async write(body) {
    const target = resolveInside(body.path);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, Buffer.from(String(body.contentBase64 || ""), "base64"));
    return {};
  },
  async stat(body) {
    try {
      const st = await fsp.stat(resolveInside(body.path));
      return { exists: true, type: st.isDirectory() ? "directory" : "file", size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      return { exists: false };
    }
  },
  async readdir(body) {
    const base = String(body.path || "/").replace(/\/+$/, "");
    const entries = await fsp.readdir(resolveInside(body.path), { withFileTypes: true });
    return {
      entries: entries
        .filter((e) => e.isFile() || e.isDirectory())
        .map((e) => ({ name: e.name, path: `${base}/${e.name}`, type: e.isDirectory() ? "directory" : "file" })),
    };
  },
  async remove(body) {
    const target = resolveInside(body.path);
    if (target === ROOT) throw new Error("refuse_remove_root");
    await fsp.rm(target, { recursive: true, force: true });
    return {};
  },
  async mkdir(body) {
    await fsp.mkdir(resolveInside(body.path), { recursive: true });
    return {};
  },
  async exec(body) {
    if (!ALLOW_EXEC) return { code: 126, stdout: "", stderr: "exec disabled on this connector" };
    return exec(String(body.command || ""), resolveInside(body.cwd), Number(body.timeoutMs || 120_000));
  },
};

http
  .createServer(async (req, res) => {
    const send = (status: number, payload: Record<string, unknown>) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, protocolVersion: PROTOCOL_VERSION });
    if (req.method !== "POST" || req.url !== "/rpc") return send(404, { ok: false, error: "not_found" });
    if (!authorized(req)) return send(401, { ok: false, error: "unauthorized" });
    try {
      const body = await readBody(req);
      const handler = handlers[String(body.op)];
      if (!handler) return send(400, { ok: false, error: "unknown_op" });
      send(200, { ok: true, protocolVersion: PROTOCOL_VERSION, ...(await handler(body)) });
    } catch (error) {
      send(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })
  .listen(PORT, () => console.log(`[agent-connector] serving ${ROOT} on :${PORT}`));
