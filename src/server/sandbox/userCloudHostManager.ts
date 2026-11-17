import path from "node:path";
import { collectSystemSkillFiles } from "@/agent/sandbox/runtimeFiles";
import { toSafeSegment } from "@/agent/sandbox/paths";
import {
  prepareAgentSandboxWorkspace,
  type AgentSandboxWorkspace,
} from "@/agent/sandbox/workspace";

export type UserCloudHostStatus = "allocating" | "ready" | "sleeping" | "stopped";

export interface UserCloudHostSession {
  userId: string;
  workspaceKey: string;
  status: UserCloudHostStatus;
  allocatedAt: number;
  lastActiveAt: number;
  idleTimeoutMs: number;
  error?: string;
}

type InternalHostEntry = UserCloudHostSession & {
  persistFn?: () => Promise<void>;
  allocatingPromise?: Promise<UserCloudHostSession>;
};

const DEFAULT_IDLE_TIMEOUT_MS = Number.parseInt(
  process.env.USER_CLOUD_HOST_IDLE_MS || String(30 * 60 * 1000),
  10,
);
const REAP_INTERVAL_MS = 60 * 1000;

const globalState = globalThis as unknown as {
  __userCloudHosts?: Map<string, InternalHostEntry>;
  __userCloudHostReaperStarted?: boolean;
};

const getHostMap = (): Map<string, InternalHostEntry> => {
  if (!globalState.__userCloudHosts) {
    globalState.__userCloudHosts = new Map();
  }
  if (!globalState.__userCloudHostReaperStarted) {
    globalState.__userCloudHostReaperStarted = true;
    const timer = setInterval(() => {
      void reapIdleUserCloudHosts();
    }, REAP_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();
  }
  return globalState.__userCloudHosts;
};

const toPublicSession = (entry: InternalHostEntry): UserCloudHostSession => ({
  userId: entry.userId,
  workspaceKey: entry.workspaceKey,
  status: entry.status,
  allocatedAt: entry.allocatedAt,
  lastActiveAt: entry.lastActiveAt,
  idleTimeoutMs: entry.idleTimeoutMs,
  ...(entry.error ? { error: entry.error } : {}),
});

export const getUserCloudHostStatus = (userId: string): UserCloudHostSession | null => {
  const entry = getHostMap().get(userId);
  return entry ? toPublicSession(entry) : null;
};

export const touchUserCloudHost = (userId: string): void => {
  const entry = getHostMap().get(userId);
  if (entry && entry.status === "ready") {
    entry.lastActiveAt = Date.now();
  }
};

/**
 * 用户登录或会话初始化时为其分配（预热）专属云主机：
 * - 绑定 workspaceKey = user-<userId>
 * - 拉取 S3 历史环境并挂载系统 skills
 * - 记录分配时间与活跃心跳，供后续所有项目文件夹复用
 */
export async function ensureUserCloudHostAllocated(userId: string): Promise<UserCloudHostSession> {
  const cleanUserId = userId.trim();
  const hosts = getHostMap();
  const workspaceKey = toSafeSegment(`user-${cleanUserId}`);
  const now = Date.now();
  const existing = hosts.get(cleanUserId);

  if (existing?.status === "ready") {
    existing.lastActiveAt = now;
    return toPublicSession(existing);
  }
  if (existing?.allocatingPromise) {
    return existing.allocatingPromise;
  }

  const entry: InternalHostEntry = existing
    ? {
        ...existing,
        status: "allocating",
        lastActiveAt: now,
        error: undefined,
      }
    : {
        userId: cleanUserId,
        workspaceKey,
        status: "allocating",
        allocatedAt: now,
        lastActiveAt: now,
        idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
      };
  hosts.set(cleanUserId, entry);

  const task = (async (): Promise<UserCloudHostSession> => {
    try {
      const runtimeFiles = collectSystemSkillFiles(path.resolve(process.cwd(), "skills"));
      const prepared: AgentSandboxWorkspace = await prepareAgentSandboxWorkspace({
        baseCwd: process.cwd(),
        workspaceIdentity: workspaceKey,
        runtimeFiles,
      });
      entry.status = "ready";
      entry.lastActiveAt = Date.now();
      entry.persistFn = prepared.persistToS3;
      entry.error = undefined;
      return toPublicSession(entry);
    } catch (error) {
      entry.status = "stopped";
      entry.error = error instanceof Error ? error.message : String(error);
      return toPublicSession(entry);
    } finally {
      entry.allocatingPromise = undefined;
    }
  })();

  entry.allocatingPromise = task;
  return task;
}

/**
 * 退出登录或超时空闲时持久化并关闭用户云主机实例。
 */
export async function releaseUserCloudHost(
  userId: string,
  reason: "logout" | "idle_timeout" = "logout",
): Promise<void> {
  const cleanUserId = userId.trim();
  const hosts = getHostMap();
  const entry = hosts.get(cleanUserId);
  if (!entry) return;

  if (entry.allocatingPromise) {
    await entry.allocatingPromise.catch(() => undefined);
  }
  if (entry.persistFn) {
    await entry.persistFn().catch((error) => {
      console.warn("[user-cloud-host] persist failed on release", {
        userId: cleanUserId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  entry.status = reason === "idle_timeout" ? "sleeping" : "stopped";
  entry.persistFn = undefined;
}

/**
 * 后台定时巡检：将长时间无操作的云主机持久化并置为休眠态。
 */
export async function reapIdleUserCloudHosts(): Promise<void> {
  const now = Date.now();
  const hosts = getHostMap();
  const expiredUserIds: string[] = [];

  for (const [userId, entry] of hosts.entries()) {
    if (entry.status === "ready" && now - entry.lastActiveAt > entry.idleTimeoutMs) {
      expiredUserIds.push(userId);
    }
  }

  await Promise.all(
    expiredUserIds.map((userId) => releaseUserCloudHost(userId, "idle_timeout")),
  );
}
