import { randomUUID } from "node:crypto";
import { createLocalDeviceGateway } from "./gateway";
import { findDevice, listGrantsForScope, upsertGrant } from "./store";

export async function requestProjectGrant({
  userId, memberName, project, deviceId, ...scope
}: {
  userId: string;
  memberName: string;
  project: { token: string; name: string };
  deviceId: string;
  chatId?: string;
  initialWorkdir?: string;
}) {
  const device = await findDevice(deviceId);
  if (!device || device.revoked || device.teamId !== userId) {
    throw new Error("device_not_found");
  }

  const gateway = createLocalDeviceGateway();
  const chatId = scope.chatId || `project_${project.token}`;
  const sourceTarget = `project:${project.token}`;
  const grants = await listGrantsForScope({ userId, appId: project.token, deviceId: device.deviceId });
  const existing = grants.find(g =>
    g.chatId === chatId && g.sourceTarget === sourceTarget && g.locallyApproved &&
    g.capabilities.includes("exec") && (!g.expiresAt || g.expiresAt > Date.now()) &&
    (!scope.initialWorkdir || g.workdir === scope.initialWorkdir)
  );
  if (existing) {
    const grant = await gateway.controlGrant({
      action: "grant_renew",
      leaseExpiresAt: Math.min(Date.now() + 50_000, existing.expiresAt || Infinity),
      grant: {
        teamId: existing.teamId, memberId: existing.memberId, deviceId: existing.deviceId,
        appId: existing.appId, chatId, sourceTarget, grantId: existing.grantId,
        version: existing.version, expiresAt: existing.expiresAt, workdir: existing.workdir,
        revoked: false,
      },
    });
    return grant;
  }

  const approved = await gateway.controlGrant({
    action: "grant_request",
    grant: {
      teamId: userId,
      memberId: userId,
      deviceId: device.deviceId,
      appId: project.token,
      chatId,
      sourceTarget,
      grantId: randomUUID(),
      version: 1,
      expiresAt: 0,
      workdir: scope.initialWorkdir || "",
      revoked: false,
      display: {
        teamName: "AI Studio",
        memberName,
        appName: project.name,
        chatTitle: project.name,
        ...(scope.initialWorkdir ? { initialWorkdir: scope.initialWorkdir } : {}),
      },
    },
  });

  await upsertGrant({
    grantId: approved.grantId,
    teamId: userId,
    memberId: userId,
    appId: project.token,
    sourceTarget: approved.sourceTarget,
    chatId: approved.chatId,
    deviceId: device.deviceId,
    version: approved.version,
    expiresAt: approved.expiresAt,
    revoked: approved.revoked,
    locallyApproved: true,
    capabilities: ["exec"],
    workdir: approved.workdir,
    createdAt: new Date(),
  });

  return approved;
}
