import type { ChatEntryValidationRules } from './type';
import type { VariableItemType } from '../app/type.d';

export const EntryCollectionName = 'entries';

export enum ChatEntryStatusEnum {
  enabled = 'enabled',
  disabled = 'disabled'
}

export enum ShareAccessPermissionsEnum {
  public = 'public', // 公开访问
  password = 'password', // 密钥登录
  login = 'login' // 账号登录
}

// Validation rules
export const ENTRY_VALIDATION_RULES: ChatEntryValidationRules = {
  name: {
    required: true,
    minLength: 1,
    maxLength: 100
  },
  url: {
    required: true,
    pattern: /^[a-zA-Z0-9_-]+$/,
    maxLength: 50
  },
  description: {
    maxLength: 500
  }
};

// Default values
export const DEFAULT_ENTRY_VALUES = {
  status: ChatEntryStatusEnum.disabled,
  shareSettings: {
    accessPermissions: ShareAccessPermissionsEnum.login,
    maxUses: -1,
    expirationTime: null
  },
  inheritPermission: true,
  chatConfig: {
    welcomeText: '',
    variables: []
  }
} as const;

// URL generation
export const ENTRY_URL_PREFIX = 'entry';
export const ENTRY_URL_SEPARATOR = '-';

// Pagination defaults
export const DEFAULT_ENTRIES_LIMIT = 20;
export const MAX_ENTRIES_LIMIT = 100;
