import appErr from './code/app';
import chatErr from './code/chat';
import datasetErr from './code/dataset';
import openapiErr from './code/openapi';
import pluginErr from './code/plugin';
import outLinkErr from './code/outLink';
import teamErr from './code/team';
import userErr from './code/user';
import commonErr from './code/common';
import SystemErrEnum from './code/system';

const providerReturnedErrorMessage = '模型返回错误';

export const ERROR_CODE: { [key: number]: string } = {
  400: '请求错误',
  401: '未授权',
  403: '禁止访问',
  404: '未找到',
  405: '方法不允许',
  406: '无法接受',
  410: '已失效',
  422: '参数错误',
  429: '请求过于频繁',
  500: '服务器错误',
  502: '网关错误',
  503: '服务不可用',
  504: '网关超时'
};

export const TOKEN_ERROR_CODE: Record<number, string> = {
  403: '登录已过期'
};

export const proxyError: Record<string, boolean> = {
  ECONNABORTED: true,
  ECONNRESET: true
};

export enum ERROR_ENUM {
  unAuthorization = 'unAuthorization',
  insufficientQuota = 'insufficientQuota',
  unAuthModel = 'unAuthModel',
  unAuthApiKey = 'unAuthApiKey',
  unAuthFile = 'unAuthFile',
  tooManyRequest = 'tooManyRequest'
}

export type ErrType<T> = Record<
  string,
  {
    code: number;
    statusText: T;
    message: string;
    data: null;
  }
>;

export const ERROR_RESPONSE: Record<
  any,
  {
    code: number;
    statusText: string;
    message: string;
    data?: any;
  }
> = {
  [ERROR_ENUM.unAuthorization]: {
    code: 403,
    statusText: ERROR_ENUM.unAuthorization,
    message: '未授权',
    data: null
  },
  'Provider returned error': {
    code: 400,
    statusText: 'providerReturnedError',
    message: providerReturnedErrorMessage,
    data: null
  },
  '400 Provider returned error': {
    code: 400,
    statusText: 'providerReturnedError',
    message: providerReturnedErrorMessage,
    data: null
  },
  [ERROR_ENUM.tooManyRequest]: {
    code: 429,
    statusText: ERROR_ENUM.tooManyRequest,
    message: '请求过于频繁',
    data: null
  },
  [ERROR_ENUM.insufficientQuota]: {
    code: 510,
    statusText: ERROR_ENUM.insufficientQuota,
    message: '配额不足',
    data: null
  },
  [ERROR_ENUM.unAuthModel]: {
    code: 511,
    statusText: ERROR_ENUM.unAuthModel,
    message: '未授权模型',
    data: null
  },
  [ERROR_ENUM.unAuthFile]: {
    code: 513,
    statusText: ERROR_ENUM.unAuthFile,
    message: '未授权文件',
    data: null
  },
  [ERROR_ENUM.unAuthApiKey]: {
    code: 514,
    statusText: ERROR_ENUM.unAuthApiKey,
    message: '未授权 API Key',
    data: null
  },
  ...appErr,
  ...chatErr,
  ...datasetErr,
  ...openapiErr,
  ...outLinkErr,
  ...teamErr,
  ...userErr,
  ...pluginErr,
  ...commonErr,
  ...SystemErrEnum
};
