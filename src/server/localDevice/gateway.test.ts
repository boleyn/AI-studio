import { expect, test } from "bun:test";
import { createLocalDeviceGateway } from "./gateway";

const target = { teamId: "team", memberId: "member", deviceId: "device" };
const query = { operationId: "operation", grantId: "grant", grantVersion: 1 };
const record = { operationId: "operation", grantId: "grant", digest: "a".repeat(64), deadline: Date.now() + 60_000, updatedAt: Date.now(), status: "completed" };

test("execution and query payloads remain separate from strict identity validation", async () => {
  const requests: any[] = [];
  const gateway = createLocalDeviceGateway(async body => {
    requests.push(body);
    return Response.json({ data: (body as any).action === "output" ? { events: [], next: 0, gap: false, done: true, truncated: false } : record });
  });
  await gateway.execute({ ...target, operation: { ...query, command: "printf ok", workdir: "/tmp", timeoutMs: 1000, deadline: record.deadline } });
  await gateway.query({ ...target, query });
  await gateway.cancel({ ...target, query });
  await gateway.output({ ...target, outputQuery: { ...query, after: 0, limit: 1 } });
  expect(requests.map(r => r.action)).toEqual(["execute", "query", "cancel", "output"]);
  for (const request of requests) {
    expect(request.principal).toEqual({ teamId: "team", memberId: "member" });
    expect(request.deviceId).toBe("device");
  }
  expect(() => gateway.query({ ...target, query, extraIdentity: "forged" } as any)).toThrow();
  expect(() => gateway.query({ ...target, query: { ...query, grantVersion: 0 } })).toThrow();
  expect(requests).toHaveLength(4);
});
