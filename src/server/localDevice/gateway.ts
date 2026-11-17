import { z } from "zod";
import {
  GatewayGrantSchema,
  IdentifierSchema,
  OperationQuerySchema,
  OperationSchema,
  OutputPageSchema,
  OutputQuerySchema,
  PrincipalSchema,
  RecordSchema,
  TargetSchema,
} from "./protocol";
import { getEmbeddedDeviceGateway } from "./socket";

const safeErrors = new Set([
  "device_offline",
  "device_owner_mismatch",
  "device_ticket_expired",
  "device_request_limit",
  "execution_outcome_unknown",
  "grant_outcome_unknown",
  "grant_rejected",
  "grant_confirmation_cancelled",
  "grant_confirmation_timeout",
  "grant_confirmation_busy",
  "grant_workdir_invalid",
  "grant_permission_conflict",
  "grant_unavailable",
  "grant_revoked",
  "grant_expired",
  "invalid_execution_lease",
  "account_access_paused",
  "account_access_removed",
  "device_busy",
  "device_paused",
  "operation_id_conflict",
  "operation_expired",
  "operation_not_found",
  "operation_output_unavailable",
]);

export const createLocalDeviceGateway = () => {
  const call = async <T>({
    body,
    schema,
    timeoutMs,
    signal,
    unknownError,
  }: {
    body: object;
    schema: z.ZodType<T>;
    timeoutMs: number;
    signal?: AbortSignal;
    unknownError: string;
  }): Promise<T> => {
    const encoded = JSON.stringify(body);
    if (Buffer.byteLength(encoded, "utf8") > 128 * 1024) {
      throw new Error("gateway_request_too_large");
    }
    if (signal?.aborted) throw new Error("gateway_request_cancelled");
    let response: Response;
    let payload: unknown;
    try {
      const requestSignal = AbortSignal.any([
        AbortSignal.timeout(timeoutMs),
        ...(signal ? [signal] : []),
      ]);
      response = await getEmbeddedDeviceGateway().dispatch(body, requestSignal);
      if (!response.body) throw new Error("missing_response_body");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 1024 * 1024 + 8192) throw new Error("response_too_large");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error(unknownError);
    }
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(payload);
      throw new Error(
        error.success && safeErrors.has(error.data.error) ? error.data.error : unknownError,
      );
    }
    const parsed = z.object({ data: schema }).strict().safeParse(payload);
    if (!parsed.success) throw new Error(unknownError);
    return parsed.data.data;
  };

  return {
    presence: async (
      input: z.infer<typeof PrincipalSchema> & { deviceIds: string[] },
      signal?: AbortSignal,
    ) => {
      const { deviceIds: rawIds, ...rawPrincipal } = input;
      const principal = PrincipalSchema.parse(rawPrincipal);
      const deviceIds = z.array(IdentifierSchema).min(1).max(50).parse(rawIds);
      if (new Set(deviceIds).size !== deviceIds.length) throw new Error("invalid_device_list");
      const result = await call({
        body: { action: "presence", principal, deviceIds },
        schema: z
          .array(z.object({ deviceId: IdentifierSchema, online: z.boolean() }).strict())
          .max(50),
        timeoutMs: 3000,
        signal,
        unknownError: "device_presence_unknown",
      });
      if (result.length !== deviceIds.length || result.some((item, idx) => item.deviceId !== deviceIds[idx])) {
        throw new Error("device_presence_unknown");
      }
      return result;
    },

    status: (input: z.infer<typeof TargetSchema>, signal?: AbortSignal) => {
      const { deviceId, ...principal } = TargetSchema.parse(input);
      return call({
        body: { action: "status", principal, deviceId },
        schema: z.object({ online: z.boolean() }).strict(),
        timeoutMs: 3000,
        signal,
        unknownError: "device_status_unknown",
      });
    },

    disconnect: (input: z.infer<typeof TargetSchema>, signal?: AbortSignal) => {
      const { deviceId, ...principal } = TargetSchema.parse(input);
      return call({
        body: { action: "disconnect", principal, deviceId },
        schema: z.object({ disconnected: z.boolean() }).strict(),
        timeoutMs: 3000,
        signal,
        unknownError: "device_disconnect_unknown",
      });
    },

    controlGrant: (
      input: {
        action: "grant_request" | "grant_renew" | "grant_revoke";
        grant: z.infer<typeof GatewayGrantSchema>;
        leaseExpiresAt?: number;
      },
      signal?: AbortSignal,
    ) => {
      const grant = GatewayGrantSchema.parse(input.grant);
      return call({
        body: {
          action: input.action,
          principal: { teamId: grant.teamId, memberId: grant.memberId },
          deviceId: grant.deviceId,
          grant,
          leaseExpiresAt: input.leaseExpiresAt,
        },
        schema: GatewayGrantSchema,
        timeoutMs: input.action === "grant_request" ? 90_000 : 10_000,
        signal,
        unknownError: "grant_outcome_unknown",
      });
    },

    execute: (
      input: z.infer<typeof TargetSchema> & { operation: z.infer<typeof OperationSchema> },
      signal?: AbortSignal,
    ) => {
      const { deviceId, ...principal } = TargetSchema.parse(input);
      return call({
        body: {
          action: "execute",
          principal,
          deviceId,
          operation: OperationSchema.parse(input.operation),
        },
        schema: RecordSchema,
        timeoutMs: Math.min(Math.max(input.operation.timeoutMs + 10_000, 15_000), 620_000),
        signal,
        unknownError: "execution_outcome_unknown",
      });
    },

    query: (
      input: z.infer<typeof TargetSchema> & { query: z.infer<typeof OperationQuerySchema> },
      signal?: AbortSignal,
    ) => {
      const { deviceId, ...principal } = TargetSchema.parse(input);
      return call({
        body: {
          action: "query",
          principal,
          deviceId,
          query: OperationQuerySchema.parse(input.query),
        },
        schema: RecordSchema,
        timeoutMs: 10_000,
        signal,
        unknownError: "execution_outcome_unknown",
      });
    },

    output: (
      input: z.infer<typeof TargetSchema> & { outputQuery: z.infer<typeof OutputQuerySchema> },
      signal?: AbortSignal,
    ) => {
      const { deviceId, ...principal } = TargetSchema.parse(input);
      return call({
        body: {
          action: "output",
          principal,
          deviceId,
          outputQuery: OutputQuerySchema.parse(input.outputQuery),
        },
        schema: OutputPageSchema,
        timeoutMs: 10_000,
        signal,
        unknownError: "execution_outcome_unknown",
      });
    },

    cancel: (
      input: z.infer<typeof TargetSchema> & { query: z.infer<typeof OperationQuerySchema> },
      signal?: AbortSignal,
    ) => {
      const { deviceId, ...principal } = TargetSchema.parse(input);
      return call({
        body: {
          action: "cancel",
          principal,
          deviceId,
          query: OperationQuerySchema.parse(input.query),
        },
        schema: RecordSchema,
        timeoutMs: 10_000,
        signal,
        unknownError: "execution_outcome_unknown",
      });
    },
  };
};
