import { type ErrType } from '../errorCode';
/* dataset: 502000 */
export enum AppErrEnum {
  unExist = 'appUnExist',
  unAuthApp = 'unAuthApp',
  invalidOwner = 'invalidOwner',
  invalidAppType = 'invalidAppType',
  canNotEditAdminPermission = 'canNotEditAdminPermission'
}
const appErrList = [
  { statusText: AppErrEnum.unExist, message: '应用不存在' },
  { statusText: AppErrEnum.unAuthApp, message: '未授权应用' },
  { statusText: AppErrEnum.invalidOwner, message: '无效的拥有者' },
  { statusText: AppErrEnum.invalidAppType, message: '无效的应用类型' },
  { statusText: AppErrEnum.canNotEditAdminPermission, message: '无法编辑管理员权限' }
];
export default appErrList.reduce((acc, cur, index) => {
  return {
    ...acc,
    [cur.statusText]: {
      code: 502000 + index,
      statusText: cur.statusText,
      message: cur.message,
      data: null
    }
  };
}, {} as ErrType<`${AppErrEnum}`>);
