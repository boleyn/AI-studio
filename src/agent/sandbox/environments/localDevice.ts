import { randomUUID } from "node:crypto";
import path from "node:path";
import { createLocalDeviceGateway } from "@/server/localDevice/gateway";
import { findGrant } from "@/server/localDevice/store";
import { normalizeVirtualPath } from "../paths";
import type {
  Sandbox,
  SandboxDirEntry,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxFileSystem,
} from "../types";

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

const resolveWorkdirPath = (workdir: string, virtualPath: string): string => {
  const rel = normalizeVirtualPath(virtualPath).slice(1);
  if (!rel) return workdir;
  return path.posix.join(workdir, rel);
};

export const createLocalDeviceSandbox = async (params: {
  workspaceKey: string;
  deviceId: string;
  grantId: string;
  userId: string;
}): Promise<Sandbox> => {
  const grant = await findGrant(params.grantId);
  if (
    !grant ||
    grant.revoked ||
    !grant.locallyApproved ||
    grant.teamId !== params.userId ||
    grant.deviceId !== params.deviceId
  ) {
    throw new Error("local_device_grant_unavailable");
  }

  const gateway = createLocalDeviceGateway();
  const baseWorkdir = grant.workdir || ".";

  const runExec = async (command: string, options: SandboxExecOptions = {}): Promise<SandboxExecResult> => {
    const operationId = randomUUID();
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 120_000, 1000), 600_000);
    const cwd = options.cwd ? resolveWorkdirPath(baseWorkdir, options.cwd) : baseWorkdir;
    const leaseExpiresAt = Date.now() + Math.min(timeoutMs + 30_000, 120_000);

    try {
      await gateway.controlGrant(
        {
          action: "grant_renew",
          grant: {
            teamId: grant.teamId,
            memberId: grant.memberId,
            deviceId: grant.deviceId,
            appId: grant.appId,
            chatId: grant.chatId,
            sourceTarget: grant.sourceTarget,
            grantId: grant.grantId,
            version: grant.version,
            expiresAt: grant.expiresAt,
            workdir: grant.workdir,
            revoked: false,
          },
          leaseExpiresAt,
        },
        options.signal,
      );

      const record = await gateway.execute(
        {
          teamId: grant.teamId,
          memberId: grant.memberId,
          deviceId: grant.deviceId,
          operation: {
            operationId,
            grantId: grant.grantId,
            grantVersion: grant.version,
            command,
            workdir: cwd,
            timeoutMs,
            deadline: Date.now() + timeoutMs,
          },
        },
        options.signal,
      );

      const result = record.result;
      if (!result) {
        return {
          code: 1,
          stdout: "",
          stderr: `local_device_exec_${record.status}`,
        };
      }
      return {
        code: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      return {
        code: 126,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const fs: SandboxFileSystem = {
    async readFile(virtualPath: string) {
      const target = resolveWorkdirPath(baseWorkdir, virtualPath);
      const res = await runExec(`base64 < ${shellQuote(target)} | tr -d '\\n'`);
      if (res.code !== 0) throw new Error(res.stderr || `read_failed:${virtualPath}`);
      return Buffer.from(res.stdout.trim(), "base64");
    },
    async readText(virtualPath: string) {
      return (await this.readFile(virtualPath)).toString("utf8");
    },
    async writeFile(virtualPath: string, content: string | Buffer) {
      const target = resolveWorkdirPath(baseWorkdir, virtualPath);
      const b64 = (typeof content === "string" ? Buffer.from(content, "utf8") : content).toString("base64");
      const dir = path.posix.dirname(target);
      const res = await runExec(
        `mkdir -p ${shellQuote(dir)} && printf '%s' ${shellQuote(b64)} | base64 -d > ${shellQuote(target)}`,
      );
      if (res.code !== 0) throw new Error(res.stderr || `write_failed:${virtualPath}`);
    },
    async exists(virtualPath: string) {
      return (await this.stat(virtualPath)) !== null;
    },
    async stat(virtualPath: string) {
      const target = resolveWorkdirPath(baseWorkdir, virtualPath);
      const res = await runExec(
        `if [ -d ${shellQuote(target)} ]; then echo "dir"; elif [ -f ${shellQuote(target)} ]; then wc -c < ${shellQuote(target)}; else exit 1; fi`,
      );
      if (res.code !== 0) return null;
      const out = res.stdout.trim();
      if (out === "dir") {
        return { type: "directory" as const, size: 0, mtimeMs: Date.now() };
      }
      return { type: "file" as const, size: Number(out) || 0, mtimeMs: Date.now() };
    },
    async readdir(virtualPath: string): Promise<SandboxDirEntry[]> {
      const base = normalizeVirtualPath(virtualPath).replace(/\/+$/, "");
      const target = resolveWorkdirPath(baseWorkdir, virtualPath);
      const res = await runExec(
        `for f in ${shellQuote(target)}/*; do [ -e "$f" ] || continue; b=$(basename "$f"); if [ -d "$f" ]; then printf 'd\\t%s\\n' "$b"; else printf 'f\\t%s\\n' "$b"; fi; done`,
      );
      if (res.code !== 0) return [];
      return res.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [kind, ...rest] = line.split("\t");
          const name = rest.join("\t");
          return {
            name,
            path: `${base}/${name}`,
            type: kind === "d" ? ("directory" as const) : ("file" as const),
          };
        });
    },
    async remove(virtualPath: string) {
      const target = resolveWorkdirPath(baseWorkdir, virtualPath);
      if (target === baseWorkdir) throw new Error("refuse_remove_root");
      await runExec(`rm -rf ${shellQuote(target)}`);
    },
    async mkdir(virtualPath: string) {
      const target = resolveWorkdirPath(baseWorkdir, virtualPath);
      await runExec(`mkdir -p ${shellQuote(target)}`);
    },
  };

  return {
    kind: "connector",
    workspaceKey: params.workspaceKey,
    fs,
    exec: runExec,
    async persist() {},
    async exportProjectFiles() {
      return {};
    },
    async dispose() {},
  };
};
