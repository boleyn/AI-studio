import { type ErrType } from '../errorCode';

/* team: 503000 */
export enum UserErrEnum {
  notUser = 'notUser',
  userExist = 'userExist',
  unAuthRole = 'unAuthRole',
  account_psw_error = 'account_psw_error',
  unAuthSso = 'unAuthSso',
  codeNotFound = 'codeNotFound',
  codeExpired = 'codeExpired',
  codeError = 'codeError'
}

const errList = [
  { statusText: UserErrEnum.notUser, message: '账号不存在' },
  { statusText: UserErrEnum.userExist, message: '账号已存在' },
  { statusText: UserErrEnum.account_psw_error, message: '账号或密码错误' },
  { statusText: UserErrEnum.unAuthSso, message: 'SSO 认证失败' },
  { statusText: UserErrEnum.codeNotFound, message: '验证码不存在' },
  { statusText: UserErrEnum.codeExpired, message: '验证码不存在' },
  { statusText: UserErrEnum.codeError, message: '验证码错误' }
];
export default errList.reduce((acc, cur, index) => {
  return {
    ...acc,
    [cur.statusText]: {
      code: 503000 + index,
      statusText: cur.statusText,
      message: cur.message,
      data: null
    }
  };
}, {} as ErrType<`${UserErrEnum}`>);
