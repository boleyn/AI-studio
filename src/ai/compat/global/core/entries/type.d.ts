import type { PermissionValueType } from '../../support/permission/type';
import type { CollaboratorItemType } from '../../support/permission/collaborator';
import type { SourceMemberType } from '../../support/user/type';
import type { EntryPermission } from '../../support/permission/entry/controller';
import type {
  SettingAIDataType,
  AppDatasetSearchParamsType,
  AppFileSelectConfigType,
  PrivateDatasetConfigType
} from '../app/type.d';
import type { SelectedDatasetType } from '../workflow/api.d';
import type { ChatEntryStatusEnum } from './constants';

export type ShareAccessPermissions = 'public' | 'password' | 'login';

export interface ChatEntryParameter {
  key: string;
  value: string;
}

export interface ChatEntryShareSettings {
  expirationTime?: Date;
  accessPermissions: ShareAccessPermissions;
  maxUses?: number;
  password?: string; // 密钥登录时的密码
}

export interface ChatEntryPermission {
  hasWritePer: boolean;
  hasManagePer: boolean;
  hasReadPer: boolean;
  isOwner: boolean;
}

// AI 路由配置
export interface EntryAIRouting {
  enabled: boolean;
  aiSettings: SettingAIDataType;
  systemPrompt?: string;
  dataset?: AppDatasetSearchParamsType & {
    datasets: SelectedDatasetType;
  };
  fileSelectConfig?: AppFileSelectConfigType;
  webSearch?: {
    enabled: boolean;
    searchCount?: number;
  };
}

import type { VariableItemType } from '../app/type.d';

export interface ChatEntry {
  private: boolean;
  _id: string;
  teamId: string;
  tmbId: string;
  url: string;
  avatar?: string;
  name: string;
  description?: string;
  welcomeText?: string; // 对话开场白
  apps: {
    tag: string;
    appId: string;
    appName?: string;
    appAvatar?: string;
    appIntro?: string;
    appType?: string;
  }[];
  aiRouting: EntryAIRouting; // AI 路由配置
  shareSettings: ChatEntryShareSettings;
  status: ChatEntryStatusEnum;
  inheritPermission: boolean;
  chatConfig?: {
    welcomeText?: string;
    variables?: VariableItemType[];
    fileSelectConfig?: AppFileSelectConfigType;
    privateDatasetConfig?: PrivateDatasetConfigType;
  };
  createdAt: Date;
  updatedAt: Date;
  permission?: EntryPermission;
  sourceMember?: SourceMemberType;
}

export interface CreateEntryData {
  avatar?: string;
  name: string;
  description?: string;
  welcomeText?: string;
}

export interface UpdateEntryData extends Partial<CreateEntryData> {
  status?: ChatEntryStatusEnum;
  inheritPermission?: boolean;
  aiRouting?: EntryAIRouting;
  apps?: {
    tag: string;
    appId: string;
    appName?: string;
  }[];
  chatConfig?: {
    welcomeText?: string;
    variables?: VariableItemType[];
    fileSelectConfig?: AppFileSelectConfigType;
    privateDatasetConfig?: PrivateDatasetConfigType;
  };
}

export interface ChatEntryListItem extends ChatEntry {
  // 移除 parametersCount，因为 schema 中没有 parameters 字段
}

export interface GetEntriesQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: ChatEntryStatusEnum | 'all';
  appId?: string;
}

export interface GetEntriesResponse {
  entries: ChatEntryListItem[];
  total: number;
  page: number;
  limit: number;
}

// Validation schemas
export interface ChatEntryValidationRules {
  name: {
    required: boolean;
    minLength: number;
    maxLength: number;
  };
  url: {
    required: boolean;
    pattern: RegExp;
    maxLength: number;
  };
  description: {
    maxLength: number;
  };
}

// API response types
export interface CreateEntryResponse {
  entry: ChatEntry;
}

export interface UpdateEntryResponse {
  entry: ChatEntry;
}

export interface DeleteEntryResponse {
  success: boolean;
}

export interface ToggleEntryStatusResponse {
  entry: ChatEntry;
}

// Permission related types (reusing existing types)
export type EntryCollaborator = CollaboratorItemType;

export interface EntryPermissionData {
  entryId: string;
  permission: PermissionValueType;
  inheritPermission: boolean;
  collaborators: EntryCollaborator[];
}

// Publish configuration types
export interface EntryShareLink {
  _id: string;
  name: string;
  shareId: string;
  type: 'public' | 'password' | 'accountLogin';
  password?: string;
  expirationTime?: Date;
  maxUses?: number;
  usageCount?: number;
  lastUsedTime?: Date;
  lastUsedIp?: string;
  lastUsedUserAgent?: string;
  isEnabled: boolean;
  createdAt: Date;

  // 新增字段，与 app 保持一致
  responseDetail?: boolean;
  showNodeStatus?: boolean;
  showRawSource?: boolean;
  immediateResponse?: string;
  defaultResponse?: string;

  limit?: {
    expiredTime?: Date;
    QPM: number;
    maxUsagePoints: number;
    hookUrl?: string;
  };
}

export interface CreateEntryShareLinkData {
  name: string;
  type: 'public' | 'password' | 'accountLogin';
  password?: string;
  expirationTime?: Date;
  maxUses?: number;

  // 新增字段，与 app 保持一致
  responseDetail?: boolean;
  showNodeStatus?: boolean;
  showRawSource?: boolean;
  immediateResponse?: string;
  defaultResponse?: string;

  limit?: {
    expiredTime?: Date;
    QPM: number;
    maxUsagePoints: number;
    hookUrl?: string;
  };
}

export interface UpdateEntryShareLinkData {
  name?: string;
  password?: string;
  expirationTime?: Date;
  maxUses?: number;

  // 新增字段，与 app 保持一致
  responseDetail?: boolean;
  showNodeStatus?: boolean;
  showRawSource?: boolean;
  immediateResponse?: string;
  defaultResponse?: string;

  limit?: {
    expiredTime?: Date;
    QPM: number;
    maxUsagePoints: number;
    hookUrl?: string;
  };
}

export interface EntryPublishConfig {
  shareLinks: EntryShareLink[];
  apiKeys: any[];
}

// Usage log types
export interface EntryUsageLog {
  id: string;
  entryId: string;
  userId?: string;
  /** 若能从团队成员解析出用户名，则返回 */
  memberName?: string;
  sessionId: string;
  /** 对话标题，与 app 历史保持一致 */
  title?: string;
  customTitle?: string;
  accessType: 'link' | 'api';
  accessSource: string; // 访问来源（链接ID或API密钥ID）
  userAgent: string;
  ip: string;
  accessTime: Date;
  messageCount: number;
  duration: number; // 会话持续时间（秒）
}

export interface EntryUsageStats {
  /** 仅会话数量（不含纯页面访问） */
  totalSessions?: number;
  totalAccess: number;
  uniqueUsers: number;
  totalMessages: number;
  avgDuration: number;
  accessByType: {
    /** 入口（链接/分享）访问 */
    entry: number;
    /** API 访问 */
    api: number;
  };
  dailyStats: Array<{
    date: string;
    access: number;
    messages: number;
  }>;
}

export interface GetEntryLogsQuery {
  startDate?: string;
  endDate?: string;
  accessType?: 'link' | 'api';
  page?: number;
  limit?: number;
  pageNum?: number | string;
  pageSize?: number | string;
  includeStats?: boolean;
  userId?: string;
}

export interface GetEntryLogsResponse {
  logs: {
    logs: EntryUsageLog[];
    total: number;
    page: number;
    limit: number;
  };
  stats?: EntryUsageStats;
}
