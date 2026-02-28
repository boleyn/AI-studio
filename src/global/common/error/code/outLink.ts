import { type ErrType } from '../errorCode';
/* dataset: 505000 */
export enum OutLinkErrEnum {
  unExist = 'outlinkUnExist',
  unAuthLink = 'unAuthLink',
  linkUnInvalid = 'linkUnInvalid',
  unAuthUser = 'unAuthUser',
  linkExpired = 'linkExpired'
}

const errList = [
  { statusText: OutLinkErrEnum.unExist, message: '外链不存在' },
  { statusText: OutLinkErrEnum.unAuthLink, message: '链接无效' },
  { code: 501, statusText: OutLinkErrEnum.linkUnInvalid, message: '链接无效' },
  { statusText: OutLinkErrEnum.unAuthUser, message: '未授权用户' },
  { statusText: OutLinkErrEnum.linkExpired, message: '链接已过期' }
];

export default errList.reduce((acc, cur, index) => {
  return {
    ...acc,
    [cur.statusText]: {
      code: cur?.code || 505000 + index,
      statusText: cur.statusText,
      message: cur.message,
      data: null
    }
  };
}, {} as ErrType<`${OutLinkErrEnum}`>);
