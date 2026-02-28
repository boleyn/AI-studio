import { type ErrType } from '../errorCode';

/* chat error codes: 504000 */
export enum ChatErrEnum {
  unAuthChat = 'unAuthChat',
  linkNotFound = 'linkNotFound',
  linkExpired = 'linkExpired',
  invalidPassword = 'invalidPassword',
  invalidCredentials = 'invalidCredentials'
}

const errList = [
  { statusText: ChatErrEnum.unAuthChat, message: '未授权会话' },
  { statusText: ChatErrEnum.linkNotFound, message: '链接不存在或已被删除' },
  { statusText: ChatErrEnum.linkExpired, message: '链接已过期' },
  { statusText: ChatErrEnum.invalidPassword, message: '密码错误' },
  { statusText: ChatErrEnum.invalidCredentials, message: '用户名或密码错误' }
];

export default errList.reduce((acc, cur, index) => {
  return {
    ...acc,
    [cur.statusText]: {
      code: 504000 + index,
      statusText: cur.statusText,
      message: cur.message,
      data: null
    }
  };
}, {} as ErrType<`${ChatErrEnum}`>);
