import { z } from 'zod';

export const LocalDeviceGatewayUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      (url.protocol === 'wss:' || url.protocol === 'ws:') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, 'Expected WS or WSS without credentials, query or fragment')
  .meta({
    description: '供设备连接的 WS/WSS 地址，使用管理员显式配置的协议和主机，不包含认证信息',
    example: 'wss://devices.example.com/connect'
  });
export type LocalDeviceGatewayUrl = z.infer<typeof LocalDeviceGatewayUrlSchema>;

export const DeviceProofSchema = z
  .object({
    purpose: z.literal('local-device-connect-v1').meta({ description: '签名用途' }),
    challengeId: z.string().min(1).max(128).meta({ description: '一次性挑战 ID' }),
    nonce: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .meta({ description: '随机挑战值' }),
    deviceId: z.string().min(1).max(128).meta({ description: '配对设备 ID' }),
    audience: z.string().min(1).max(2048).meta({ description: '服务端确定的连接目标' }),
    expiresAt: z.number().int().positive().meta({ description: '挑战失效毫秒时间戳' })
  })
  .strict();
export type DeviceProof = z.infer<typeof DeviceProofSchema>;

/** 服务端与连接器共同核对的授权范围；不得采用模型提供的身份字段。 */
export const LocalDeviceScopeSchema = z.object({
  teamId: z.string().min(1),
  memberId: z.string().min(1),
  appId: z.string().min(1),
  sourceTarget: z.string().min(1),
  chatId: z.string().min(1),
  deviceId: z.string().min(1)
});
export type LocalDeviceScope = z.infer<typeof LocalDeviceScopeSchema>;

export const LocalDeviceGrantSchema = LocalDeviceScopeSchema.extend({
  grantId: z.string().min(1),
  version: z.number().int().positive(),
  expiresAt: z
    .number()
    .int()
    .nonnegative()
    .meta({ description: '授权到期毫秒时间戳；0 表示持续到主动撤销' }),
  revoked: z.boolean(),
  locallyApproved: z.boolean(),
  workdir: z
    .string()
    .max(4096)
    .optional()
    .meta({ description: '本人在本机批准的当前工作目录，仅用于展示' }),
  capabilities: z.array(z.enum(['exec']))
});
export type LocalDeviceGrant = z.infer<typeof LocalDeviceGrantSchema>;

/** 每轮受理时冻结；实际调用仍须重新检查应用开关、授权和设备状态。 */
export const LocalDeviceTurnSchema = LocalDeviceScopeSchema.extend({
  grantId: z.string().min(1),
  grantVersion: z.number().int().positive()
});
export type LocalDeviceTurn = z.infer<typeof LocalDeviceTurnSchema>;

/** 浏览器只能选择单个已批准的设备授权，不能指定执行身份或权限。 */
export const LocalDeviceSelectionSchema = z
  .object({
    deviceId: z.string().uuid().meta({ description: '本轮选中的个人设备 ID' }),
    grantId: z.string().uuid().meta({ description: '该设备已在本机批准的会话授权 ID' })
  })
  .strict();
export type LocalDeviceSelection = z.infer<typeof LocalDeviceSelectionSchema>;

export const LocalDeviceCommandSchema = z
  .object({
    command: z
      .string()
      .min(1)
      .max(65536)
      .refine((value) => !value.includes('\0')),
    workdir: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes('\0'))
      .optional(),
    timeoutMs: z.number().int().min(1).max(600000).default(120000)
  })
  .strict();
export type LocalDeviceCommand = z.infer<typeof LocalDeviceCommandSchema>;

export const LocalDeviceDescriptionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .meta({ description: '用户可识别的设备名称', example: '我的电脑' }),
  platform: z
    .enum(['darwin', 'linux', 'windows'])
    .meta({ description: '设备操作系统', example: 'windows' })
});
export type LocalDeviceDescription = z.infer<typeof LocalDeviceDescriptionSchema>;

export const LocalDeviceSummarySchema = LocalDeviceDescriptionSchema.extend({
  connectionStatus: z.enum(['online', 'offline', 'unknown']).optional().meta({
    description: '网关连接快照；查询失败为 unknown，不能视为离线或执行授权',
    example: 'online'
  }),
  deviceId: z
    .string()
    .uuid()
    .meta({ description: '绑定设备 ID', example: '952b227c-4c30-486b-90ad-e89df81d1246' }),
  fingerprint: z
    .string()
    .meta({ description: '设备公钥 SHA-256 指纹', example: 'SHA256 fingerprint' }),
  revoked: z.boolean().meta({ description: '是否已解除绑定', example: false }),
  createdAt: z.number().meta({ description: '绑定时间，毫秒时间戳', example: 1793232000000 })
});
export type LocalDeviceSummary = z.infer<typeof LocalDeviceSummarySchema>;
