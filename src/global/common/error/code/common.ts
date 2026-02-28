import { type ErrType } from '../errorCode';

/* dataset: 507000 */
const startCode = 507000;
export enum CommonErrEnum {
  invalidParams = 'invalidParams',
  invalidResource = 'invalidResource',
  fileNotFound = 'fileNotFound',
  unAuthFile = 'unAuthFile',
  missingParams = 'missingParams',
  inheritPermissionError = 'inheritPermissionError'
}
const datasetErr = [
  { statusText: CommonErrEnum.invalidParams, message: '参数无效' },
  { statusText: CommonErrEnum.invalidResource, message: '无效资源' },
  { statusText: CommonErrEnum.fileNotFound, message: '文件不存在' },
  { statusText: CommonErrEnum.unAuthFile, message: '未授权文件' },
  { statusText: CommonErrEnum.missingParams, message: '缺少参数' },
  { statusText: CommonErrEnum.inheritPermissionError, message: '继承权限错误' }
];
export default datasetErr.reduce((acc, cur, index) => {
  return {
    ...acc,
    [cur.statusText]: {
      code: startCode + index,
      statusText: cur.statusText,
      message: cur.message,
      data: null
    }
  };
}, {} as ErrType<`${CommonErrEnum}`>);
