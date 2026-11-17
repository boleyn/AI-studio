type LeaseEntry = {
  value: string;
  expiresAt: number;
};

type WindowEntry = {
  count: number;
  resetAt: number;
};

const globalStore = globalThis as typeof globalThis & {
  __aistudioLocalDeviceLeases?: Map<string, LeaseEntry>;
  __aistudioLocalDeviceWindows?: Map<string, WindowEntry>;
};

const leases =
  globalStore.__aistudioLocalDeviceLeases ??
  (globalStore.__aistudioLocalDeviceLeases = new Map<string, LeaseEntry>());
const windows =
  globalStore.__aistudioLocalDeviceWindows ??
  (globalStore.__aistudioLocalDeviceWindows = new Map<string, WindowEntry>());

export const localDeviceLeaseStore = {
  async acquireLease({ key, token, ttlMs }: { key: string; token: string; ttlMs: number }) {
    const now = Date.now();
    const existing = leases.get(key);
    if (existing && existing.expiresAt > now) {
      return false;
    }
    leases.set(key, { value: token, expiresAt: now + Math.max(1000, ttlMs) });
    return true;
  },

  async get(key: string): Promise<string | null> {
    const now = Date.now();
    const entry = leases.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      leases.delete(key);
      return null;
    }
    return entry.value;
  },

  async releaseLease({ key, token }: { key: string; token: string }): Promise<boolean> {
    const entry = leases.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      leases.delete(key);
      return false;
    }
    if (entry.value !== token) return false;
    leases.delete(key);
    return true;
  },

  async consumeFixedWindow({ key, windowSeconds }: { key: string; windowSeconds: number }) {
    const now = Date.now();
    const entry = windows.get(key);
    if (!entry || entry.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { currentCount: 1 };
    }
    entry.count += 1;
    return { currentCount: entry.count };
  },
};
