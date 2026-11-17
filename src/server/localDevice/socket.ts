import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { LOCAL_DEVICE_GATEWAY_AUDIENCE } from "@/shared/localDevice/constants";
import { createDeviceTicketService } from "./ticket";
import {
  GatewayGrantSchema,
  IdentifierSchema,
  OperationQuerySchema,
  OperationSchema,
  OutputPageSchema,
  OutputQuerySchema,
  PrincipalSchema,
  RecordSchema,
} from "./protocol";

const IdentitySchema = z.object({
  deviceId: IdentifierSchema,
  teamId: IdentifierSchema,
  memberId: IdentifierSchema,
  expiresAt: z.number().int().positive(),
});
type Identity = z.infer<typeof IdentitySchema>;
type Principal = z.infer<typeof PrincipalSchema>;

const header = {
  version: z.literal(1),
  epoch: IdentifierSchema,
  requestId: IdentifierSchema,
};

const ResponseFrameSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...header,
      type: z.literal("auth_refresh"),
      authTicket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .strict(),
  z
    .object({
      ...header,
      type: z.literal("exec_result"),
      operationId: IdentifierSchema,
      record: RecordSchema,
    })
    .strict(),
  z
    .object({
      ...header,
      type: z.literal("exec_output"),
      operationId: IdentifierSchema,
      output: OutputPageSchema,
    })
    .strict(),
  z
    .object({
      ...header,
      type: z.literal("exec_error"),
      operationId: IdentifierSchema,
      error: IdentifierSchema,
    })
    .strict(),
  z
    .object({
      ...header,
      type: z.literal("grant_result"),
      grantId: IdentifierSchema,
      grant: GatewayGrantSchema,
    })
    .strict(),
  z
    .object({
      ...header,
      type: z.literal("grant_error"),
      grantId: IdentifierSchema,
      error: IdentifierSchema,
    })
    .strict(),
]);

type ResponseFrame = z.infer<typeof ResponseFrameSchema>;

type Pending = {
  operationId?: string;
  grantId?: string;
  resolve: (frame: ResponseFrame) => void;
  reject: (error: Error) => void;
};

type Connection = {
  serverClock: boolean;
  socket: WebSocket;
  identity: Identity;
  epoch: string;
  pending: Map<string, Pending>;
  expiry?: NodeJS.Timeout;
  ping?: NodeJS.Timeout;
  pong?: NodeJS.Timeout;
  refreshing: boolean;
};

const RequestSchema = z
  .object({
    action: z.enum([
      "presence",
      "status",
      "disconnect",
      "execute",
      "query",
      "cancel",
      "output",
      "grant_request",
      "grant_renew",
      "grant_revoke",
    ]),
    principal: PrincipalSchema,
    deviceId: IdentifierSchema.optional(),
    deviceIds: z.array(IdentifierSchema).min(1).max(50).optional(),
    operation: OperationSchema.optional(),
    query: OperationQuerySchema.optional(),
    outputQuery: OutputQuerySchema.optional(),
    grant: GatewayGrantSchema.optional(),
    leaseExpiresAt: z.number().int().positive().optional(),
  })
  .strict();

const makeId = () => randomBytes(24).toString("hex");
const sameOwner = (identity: Identity, principal: Principal) =>
  identity.teamId === principal.teamId && identity.memberId === principal.memberId;

export class EmbeddedDeviceGateway {
  private connections = new Map<string, Connection>();
  private revoked = new Map<string, number>();
  private servers = new WeakSet<Server>();
  private upgrading = 0;

  constructor(
    private authenticate: (ticket: string) => Promise<Identity | null> = async (ticket: string) =>
      createDeviceTicketService().consume({ ticket, audience: LOCAL_DEVICE_GATEWAY_AUDIENCE }),
  ) {}

  private async authenticateWithinDeadline(ticket: string) {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.authenticate(ticket),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("device_auth_timeout")), 5000);
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  attach(server: Server) {
    if (this.servers.has(server)) return;
    this.servers.add(server);
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 + 4096 });
    server.on("upgrade", (req, socket, head) => {
      const path = (req.url ?? "").split("?")[0];
      if (path !== "/local-device/connect") return;
      void this.upgrade({ req, socket, head, sockets });
    });
  }

  private async upgrade({
    req,
    socket,
    head,
    sockets,
  }: {
    req: IncomingMessage;
    socket: Duplex;
    head: Buffer;
    sockets: WebSocketServer;
  }) {
    const reject = (status: number) => {
      if (!socket.destroyed) {
        socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      }
    };
    const authorization = req.headers.authorization;
    if (
      req.method !== "GET" ||
      req.url?.includes("?") ||
      req.headers.origin ||
      !authorization?.startsWith("Bearer ") ||
      !/^[A-Za-z0-9_-]{43}$/.test(authorization.slice(7))
    ) {
      reject(401);
      return;
    }
    if (this.upgrading >= 64) {
      reject(503);
      return;
    }
    this.upgrading++;
    try {
      const identity = IdentitySchema.parse(
        await this.authenticateWithinDeadline(authorization.slice(7)),
      );
      if (
        socket.destroyed ||
        identity.expiresAt <= Date.now() ||
        identity.expiresAt > Date.now() + 300_000 ||
        (this.revoked.get(identity.deviceId) ?? 0) > Date.now()
      ) {
        reject(401);
        return;
      }
      const serverClock = req.headers["x-fastgpt-clock"] === "server-time-v1";
      sockets.handleUpgrade(req, socket, head, (ws) => void this.connected(ws, identity, serverClock));
    } catch {
      reject(401);
    } finally {
      this.upgrading--;
    }
  }

  private send(connection: Connection, frame: object): Promise<void> {
    return new Promise((resolve, reject) => {
      if (
        connection.socket.readyState !== WebSocket.OPEN ||
        connection.socket.bufferedAmount > 2 * 1024 * 1024
      ) {
        reject(new Error("execution_outcome_unknown"));
        return;
      }
      connection.socket.send(
        JSON.stringify({
          version: 1,
          epoch: connection.epoch,
          ...frame,
          ...(connection.serverClock ? { serverTime: Date.now() } : {}),
        }),
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  private armExpiry(connection: Connection) {
    clearTimeout(connection.expiry);
    connection.expiry = setTimeout(
      () => connection.socket.terminate(),
      Math.max(0, connection.identity.expiresAt - Date.now()),
    );
    connection.expiry.unref();
  }

  private async connected(socket: WebSocket, identity: Identity, serverClock: boolean) {
    const connection: Connection = {
      serverClock,
      socket,
      identity,
      epoch: makeId(),
      pending: new Map(),
      refreshing: false,
    };
    const cleanup = () => {
      clearTimeout(connection.expiry);
      clearTimeout(connection.pong);
      clearInterval(connection.ping);
      if (this.connections.get(identity.deviceId) === connection) {
        this.connections.delete(identity.deviceId);
      }
      for (const pending of connection.pending.values()) {
        pending.reject(new Error("execution_outcome_unknown"));
      }
      connection.pending.clear();
    };
    socket.on("close", cleanup);
    socket.on("error", () => socket.terminate());
    socket.on("message", (data, binary) => {
      if (binary) {
        socket.terminate();
        return;
      }
      void this.message(connection, data.toString()).catch(() => socket.terminate());
    });
    socket.on("pong", () => clearTimeout(connection.pong));
    try {
      await this.send(connection, {
        type: "welcome",
        owner: {
          deviceId: identity.deviceId,
          teamId: identity.teamId,
          memberId: identity.memberId,
        },
        authExpiresAt: identity.expiresAt,
      });
      if (
        socket.readyState !== WebSocket.OPEN ||
        (this.revoked.get(identity.deviceId) ?? 0) > Date.now() ||
        (!this.connections.has(identity.deviceId) && this.connections.size >= 1024)
      ) {
        socket.close(1008, "device_unavailable");
        return;
      }
      const previous = this.connections.get(identity.deviceId);
      this.connections.set(identity.deviceId, connection);
      previous?.socket.terminate();
      this.armExpiry(connection);
      connection.ping = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.ping();
        connection.pong = setTimeout(() => socket.terminate(), 10_000);
        connection.pong.unref();
      }, 20_000);
      connection.ping.unref();
    } catch {
      socket.terminate();
    }
  }

  private async message(connection: Connection, raw: string) {
    const frame = ResponseFrameSchema.parse(JSON.parse(raw));
    if (frame.epoch !== connection.epoch) throw new Error("invalid_connection_epoch");
    if (frame.type === "auth_refresh") {
      if (connection.refreshing || connection.identity.expiresAt <= Date.now()) {
        throw new Error("device_ticket_expired");
      }
      connection.refreshing = true;
      try {
        const next = IdentitySchema.parse(await this.authenticateWithinDeadline(frame.authTicket));
        if (
          connection.identity.expiresAt <= Date.now() ||
          next.deviceId !== connection.identity.deviceId ||
          !sameOwner(next, connection.identity) ||
          next.expiresAt <= connection.identity.expiresAt ||
          next.expiresAt > Date.now() + 300_000 ||
          (this.revoked.get(next.deviceId) ?? 0) > Date.now()
        ) {
          throw new Error("device_owner_mismatch");
        }
        connection.identity = next;
        this.armExpiry(connection);
        await this.send(connection, {
          type: "auth_refreshed",
          requestId: frame.requestId,
          authExpiresAt: next.expiresAt,
        });
      } finally {
        connection.refreshing = false;
      }
      return;
    }
    const pending = connection.pending.get(frame.requestId);
    if (!pending) return;
    const operationId = "operationId" in frame ? frame.operationId : undefined;
    const grantId = "grantId" in frame ? frame.grantId : undefined;
    if (pending.operationId !== operationId || pending.grantId !== grantId) {
      throw new Error("invalid_response_scope");
    }
    if (frame.type === "exec_error" || frame.type === "grant_error") {
      pending.reject(new Error(frame.error));
    } else {
      pending.resolve(frame);
    }
  }

  private async call(connection: Connection, frame: Record<string, unknown>, signal: AbortSignal) {
    if (signal.aborted) throw new Error("execution_outcome_unknown");
    if (connection.pending.size >= 8) throw new Error("device_request_limit");
    const requestId = makeId();
    return new Promise<ResponseFrame>((resolve, reject) => {
      const finish = (error?: Error, result?: ResponseFrame) => {
        signal.removeEventListener("abort", abort);
        connection.pending.delete(requestId);
        if (error) reject(error);
        else if (result) resolve(result);
      };
      const abort = () => {
        if (frame.type === "exec_start") {
          void this.send(connection, {
            type: "exec_cancel",
            requestId,
            operationId: frame.operationId,
          }).catch(() => {});
        }
        finish(new Error("execution_outcome_unknown"));
      };
      connection.pending.set(requestId, {
        operationId: frame.operationId as string | undefined,
        grantId: frame.grantId as string | undefined,
        resolve: (result) => finish(undefined, result),
        reject: (error) => finish(error),
      });
      signal.addEventListener("abort", abort, { once: true });
      void this.send(connection, { ...frame, requestId }).catch(() =>
        finish(new Error("execution_outcome_unknown")),
      );
    });
  }

  async dispatch(body: object, signal: AbortSignal): Promise<Response> {
    let unknownError = "execution_outcome_unknown";
    try {
      const input = RequestSchema.parse(body);
      if (input.action.startsWith("grant_")) unknownError = "grant_outcome_unknown";
      const online = (deviceId: string) => {
        const connection = this.connections.get(deviceId);
        return (
          Boolean(connection) &&
          sameOwner(connection!.identity, input.principal) &&
          connection!.identity.expiresAt > Date.now()
        );
      };
      if (input.action === "presence") {
        const ids = z.array(IdentifierSchema).min(1).max(50).parse(input.deviceIds);
        return Response.json({
          data: ids.map((deviceId) => ({ deviceId, online: online(deviceId) })),
        });
      }
      const deviceId = IdentifierSchema.parse(input.deviceId);
      const connection = this.connections.get(deviceId);
      if (input.action === "status") return Response.json({ data: { online: online(deviceId) } });
      if (connection && !sameOwner(connection.identity, input.principal)) {
        throw new Error("device_owner_mismatch");
      }
      if (input.action === "disconnect") {
        for (const [id, expiry] of this.revoked) if (expiry <= Date.now()) this.revoked.delete(id);
        if (!this.revoked.has(deviceId) && this.revoked.size >= 4096) {
          throw new Error("device_request_limit");
        }
        this.revoked.set(deviceId, Date.now() + 360_000);
        this.connections.delete(deviceId);
        connection?.socket.close(1008, "device_revoked");
        return Response.json({ data: { disconnected: true } });
      }
      if (!connection) throw new Error("device_offline");
      if (connection.identity.expiresAt <= Date.now()) throw new Error("device_ticket_expired");
      let frame: Record<string, unknown>;
      if (input.action.startsWith("grant_")) {
        const grant = GatewayGrantSchema.parse(input.grant);
        if (grant.deviceId !== deviceId || !sameOwner(connection.identity, grant)) {
          throw new Error("device_owner_mismatch");
        }
        frame = {
          type: input.action,
          grantId: grant.grantId,
          grant,
          leaseExpiresAt: input.leaseExpiresAt,
        };
      } else if (input.action === "execute") {
        const request = OperationSchema.parse(input.operation);
        frame = { type: "exec_start", operationId: request.operationId, request };
      } else if (input.action === "output") {
        const outputQuery = OutputQuerySchema.parse(input.outputQuery);
        frame = { type: "exec_output_query", operationId: outputQuery.operationId, outputQuery };
      } else {
        const query = OperationQuerySchema.parse(input.query);
        frame = {
          type: input.action === "cancel" ? "exec_cancel_query" : "exec_query",
          operationId: query.operationId,
          query,
        };
      }
      const result = await this.call(connection, frame, signal);
      const data =
        "grant" in result
          ? result.grant
          : "record" in result
            ? result.record
            : "output" in result
              ? result.output
              : undefined;
      if (!data) throw new Error("invalid_gateway_response");
      return Response.json({ data });
    } catch (error) {
      const message =
        error instanceof Error && /^[a-z][a-z0-9_]{0,100}$/.test(error.message)
          ? error.message === "execution_outcome_unknown"
            ? unknownError
            : error.message
          : "gateway_request_failed";
      return Response.json({ error: message }, { status: 503 });
    }
  }
}

const stateKey = Symbol.for("aistudio.embedded-device-gateway");

export const getEmbeddedDeviceGateway = () => {
  const state = process as typeof process & { [key: symbol]: unknown };
  if (!state[stateKey]) state[stateKey] = new EmbeddedDeviceGateway();
  return state[stateKey] as EmbeddedDeviceGateway;
};
