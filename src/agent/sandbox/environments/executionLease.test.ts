import { expect, test } from "bun:test";
import { withExecutionLease } from "./executionLease";

test("renews bounded leases sequentially and stops after completion", async () => {
  let calls = 0;
  let active = 0;
  await withExecutionLease(async expiresAt => {
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(50_000);
    expect(expiresAt - Date.now()).toBeGreaterThan(45_000);
    expect(++active).toBe(1);
    calls++;
    await Bun.sleep(5);
    active--;
  }, async () => { await Bun.sleep(45); return "ok"; }, undefined, 5);
  const finished = calls;
  await Bun.sleep(25);
  expect(calls).toBe(finished);
  expect(calls).toBeGreaterThan(1);
});

test("renewal failure aborts active work and never retries it", async () => {
  let renewals = 0;
  let executions = 0;
  await expect(withExecutionLease(async () => {
    if (++renewals > 1) throw new Error("grant_revoked");
  }, async signal => {
    executions++;
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  }, undefined, 5)).rejects.toThrow("grant_revoked");
  expect(executions).toBe(1);
});

test("initial denial prevents execution", async () => {
  let executed = false;
  await expect(withExecutionLease(async () => { throw new Error("denied"); }, async () => { executed = true; })).rejects.toThrow("denied");
  expect(executed).toBe(false);
});
