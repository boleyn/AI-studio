import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeMissingRequiredMcpServers,
  recoverRunningTaskState,
  waitForPumpWithTimeout,
} from "./manager";

test("recoverRunningTaskState marks running task as failed when strategy=fail", () => {
  const recovered = recoverRunningTaskState({
    status: "running",
    queue: ["next"],
    strategy: "fail",
  });
  assert.equal(recovered.status, "failed");
  assert.equal(recovered.queue.length, 1);
  assert.ok((recovered.error || "").includes("Recovered running subagent"));
});

test("recoverRunningTaskState requeues current prompt when strategy=requeue", () => {
  const recovered = recoverRunningTaskState({
    status: "running",
    queue: ["queued"],
    currentPrompt: "inflight",
    strategy: "requeue",
  });
  assert.equal(recovered.status, "completed");
  assert.deepEqual(recovered.queue, ["inflight", "queued"]);
});

test("computeMissingRequiredMcpServers resolves success and missing cases", () => {
  const success = computeMissingRequiredMcpServers({
    required: ["alpha-server"],
    connectedServerNames: ["alpha_server"],
    serverNamesWithTools: [],
    inferredServerNames: [],
  });
  assert.deepEqual(success.missing, []);

  const missing = computeMissingRequiredMcpServers({
    required: ["beta-server"],
    connectedServerNames: [],
    serverNamesWithTools: [],
    inferredServerNames: ["gamma-server"],
  });
  assert.deepEqual(missing.missing, ["beta-server"]);
});

test("waitForPumpWithTimeout times out pending foreground run", async () => {
  let aborted = false;
  const never = new Promise<void>(() => {
    // keep pending
  });
  const task = {
    pump: never,
    currentAbort: { abort: () => { aborted = true; } },
    status: "running",
    error: undefined,
    updatedAt: 0,
  } as any;

  const timedOut = await waitForPumpWithTimeout(task, 1000);
  assert.equal(timedOut, true);
  assert.equal(aborted, true);
  assert.equal(task.status, "failed");
  assert.ok((task.error || "").includes("timed out"));
});
