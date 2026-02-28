import { type ErrType } from '../errorCode';
/* dataset: 506000 */
export enum OpenApiErrEnum {
  unExist = 'openapiUnExist',
  unAuth = 'openapiUnAuth',
  exceedLimit = 'openapiExceedLimit',
  keyAlreadyExists = 'openapiKeyAlreadyExists',
  invalidKey = 'openapiInvalidKey'
}

const errList = [
  { statusText: OpenApiErrEnum.unExist, message: 'API Key 不存在' },
  { statusText: OpenApiErrEnum.unAuth, message: '未授权' },
  { statusText: OpenApiErrEnum.exceedLimit, message: '超出限制' },
  { statusText: OpenApiErrEnum.keyAlreadyExists, message: 'Key 已存在' },
  { statusText: OpenApiErrEnum.invalidKey, message: '无效的 API Key' }
];

export default errList.reduce((acc, cur, index) => {
  return {
    ...acc,
    [cur.statusText]: {
      code: 506000 + index,
      statusText: cur.statusText,
      message: cur.message,
      data: null
    }
  };
}, {} as ErrType<`${OpenApiErrEnum}`>);
