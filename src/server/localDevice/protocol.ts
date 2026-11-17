import { z } from "zod";
import { LocalDeviceCommandSchema, LocalDeviceScopeSchema } from "@/shared/localDevice/type";

export const IdentifierSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const PrincipalSchema = z
  .object({ teamId: IdentifierSchema, memberId: IdentifierSchema })
  .strict();
export const TargetSchema = PrincipalSchema.extend({ deviceId: IdentifierSchema });

export const GatewayGrantSchema = LocalDeviceScopeSchema.extend({
  teamId: IdentifierSchema,
  memberId: IdentifierSchema,
  deviceId: IdentifierSchema,
  appId: IdentifierSchema,
  chatId: IdentifierSchema,
  sourceTarget: z.string().min(1).max(512),
  grantId: IdentifierSchema,
  version: z.number().int().positive(),
  expiresAt: z.number().int().nonnegative(),
  workdir: z.string().max(4096),
  revoked: z.boolean(),
  display: z
    .object({
      teamName: z.string().max(200),
      memberName: z.string().max(200),
      appName: z.string().max(200),
      chatTitle: z.string().max(200),
      initialWorkdir: z.string().max(4096).optional(),
    })
    .strict()
    .optional(),
}).strict();

export const OperationSchema = LocalDeviceCommandSchema.extend({
  operationId: IdentifierSchema,
  grantId: IdentifierSchema,
  grantVersion: z.number().int().positive(),
  deadline: z.number().int().positive(),
});

export const OperationQuerySchema = OperationSchema.pick({
  operationId: true,
  grantId: true,
  grantVersion: true,
}).strict();

export const OutputQuerySchema = OperationQuerySchema.extend({
  after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  limit: z.number().int().min(1).max(64),
}).strict();

export const OutputPageSchema = z
  .object({
    events: z
      .array(
        z
          .object({
            seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            stream: z.enum(["stdout", "stderr"]),
            data: z.string().min(4).max(5464),
          })
          .strict(),
      )
      .max(64),
    next: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    gap: z.boolean(),
    done: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();

const StatusSchema = z.enum([
  "accepted",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "unknown",
]);

export const RecordSchema = z
  .object({
    operationId: IdentifierSchema,
    grantId: IdentifierSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    deadline: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
    status: StatusSchema,
    result: z
      .object({
        status: StatusSchema,
        stdout: z.string(),
        stderr: z.string(),
        exitCode: z.number().int(),
        outputTruncated: z.boolean(),
        actualWorkdir: z.string(),
        terminationReason: z.string().max(100).optional(),
        startedAt: z.number().int().nonnegative().optional(),
        finishedAt: z.number().int().nonnegative().optional(),
        error: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
