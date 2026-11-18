import { randomUUID } from "node:crypto";
import { createLocalDeviceGateway } from "@/server/localDevice/gateway";
import { findGrant } from "@/server/localDevice/store";
import { createPosixDeviceFileSystem, resolveWorkdirPath } from "./posixDeviceFs";
import { withExecutionLease } from "./executionLease";
import { prepareConnectorWorkspace } from "../connectorWorkspace";
import type {
  Sandbox,
  SandboxExecOptions,
  SandboxExecResult,
} from "../types";

export const createLocalDeviceSandbox = async (params: {
  workspaceKey: string;
  deviceId: string;
  grantId: string;
  userId: string;
  runtimeFiles?: import("../types").ProjectFiles;
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

    try {
      const record = await withExecutionLease(
        (leaseExpiresAt, signal) => gateway.controlGrant(
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
          signal,
        ),
        (signal) => gateway.execute(
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
          signal,
        ),
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
        stdout: (result.stdout + (result.stdoutFile ? `\n[Full output: ${result.stdoutFile}; read rather than rerun.]` : "")).split(`${baseWorkdir}/`).join("/"),
        stderr: (result.stderr + (result.stderrFile ? `\n[Full output: ${result.stderrFile}; read rather than rerun.]` : "")).split(`${baseWorkdir}/`).join("/"),
      };
    } catch (error) {
      return {
        code: 126,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const fs = createPosixDeviceFileSystem(baseWorkdir, runExec);
  const workspace = await prepareConnectorWorkspace(fs, params.runtimeFiles);

  return {
    kind: "connector",
    workspaceKey: params.workspaceKey,
    fs,
    exec: runExec,
    async persist() {},
    exportProjectFiles: workspace.exportChangedFiles,
    async dispose() {},
  };
};
