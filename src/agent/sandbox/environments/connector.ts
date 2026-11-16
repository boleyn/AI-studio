import { normalizeVirtualPath } from "../paths";
import type {
  Sandbox,
  SandboxDirEntry,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxFileSystem,
} from "../types";

/**
 * 连接器沙盒：用户在自己电脑上运行 projects/agent-connector（`bun run connector`），
 * 把本机某个目录挂载为工作空间。服务端通过 HTTP RPC 读写文件 / 执行命令。
 *
 * 协议：POST {url}/rpc  header: x-aistudio-connector-token
 *   body: { op, path?, contentBase64?, command?, cwd?, timeoutMs? }
 */
export const CONNECTOR_PROTOCOL_VERSION = 1;

type RpcResult = Record<string, unknown> & { ok?: boolean; error?: string };

export class ConnectorClient {
  constructor(
    private readonly url: string,
    private readonly token?: string,
  ) {}

  async call(op: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<RpcResult> {
    const response = await fetch(`${this.url.replace(/\/$/, "")}/rpc`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { "x-aistudio-connector-token": this.token } : {}),
      },
      body: JSON.stringify({ protocolVersion: CONNECTOR_PROTOCOL_VERSION, op, ...payload }),
    });
    const data = (await response.json().catch(() => ({}))) as RpcResult;
    if (!response.ok || data.ok === false) {
      throw new Error(`connector_${op}_failed: ${data.error || response.status}`);
    }
    return data;
  }
}

class ConnectorFileSystem implements SandboxFileSystem {
  constructor(private readonly client: ConnectorClient) {}

  async readFile(virtualPath: string) {
    const data = await this.client.call("read", { path: normalizeVirtualPath(virtualPath) });
    return Buffer.from(String(data.contentBase64 || ""), "base64");
  }
  async readText(virtualPath: string) {
    return (await this.readFile(virtualPath)).toString("utf8");
  }
  async writeFile(virtualPath: string, content: string | Buffer) {
    const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    await this.client.call("write", { path: normalizeVirtualPath(virtualPath), contentBase64: buffer.toString("base64") });
  }
  async exists(virtualPath: string) {
    return (await this.stat(virtualPath)) !== null;
  }
  async stat(virtualPath: string) {
    const data = await this.client.call("stat", { path: normalizeVirtualPath(virtualPath) });
    if (!data.exists) return null;
    return {
      type: data.type === "directory" ? ("directory" as const) : ("file" as const),
      size: Number(data.size || 0),
      mtimeMs: Number(data.mtimeMs || 0),
    };
  }
  async readdir(virtualPath: string): Promise<SandboxDirEntry[]> {
    const data = await this.client.call("readdir", { path: normalizeVirtualPath(virtualPath) });
    return Array.isArray(data.entries) ? (data.entries as SandboxDirEntry[]) : [];
  }
  async remove(virtualPath: string) {
    await this.client.call("remove", { path: normalizeVirtualPath(virtualPath) });
  }
  async mkdir(virtualPath: string) {
    await this.client.call("mkdir", { path: normalizeVirtualPath(virtualPath) });
  }
}

export const createConnectorSandbox = (params: {
  workspaceKey: string;
  url: string;
  token?: string;
}): Sandbox => {
  const client = new ConnectorClient(params.url, params.token);
  const fs = new ConnectorFileSystem(client);
  return {
    kind: "connector",
    workspaceKey: params.workspaceKey,
    fs,
    async exec(command: string, options: SandboxExecOptions = {}): Promise<SandboxExecResult> {
      try {
        const data = await client.call(
          "exec",
          { command, cwd: normalizeVirtualPath(options.cwd || "/"), timeoutMs: options.timeoutMs ?? 120_000 },
          options.signal,
        );
        return {
          code: typeof data.code === "number" ? data.code : 1,
          stdout: String(data.stdout || ""),
          stderr: String(data.stderr || ""),
        };
      } catch (error) {
        return { code: 126, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
      }
    },
    // 文件直接落在用户本机，无需持久化，也不回写编辑器
    async persist() {},
    async exportProjectFiles() {
      return {};
    },
    async dispose() {},
  };
};
