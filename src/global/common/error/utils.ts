import { replaceSensitiveText } from '../string/tools';
import { ERROR_RESPONSE } from './errorCode';

const normalizeErrKey = (msg: string) =>
  typeof msg === 'string' && msg.includes('Provider returned') ? 'Provider returned error' : msg;

export const getErrText = (err: any, def = ''): any => {
  const msg: string =
    typeof err === 'string'
      ? err
      : err?.response?.data?.message ||
        err?.response?.message ||
        err?.message ||
        err?.response?.data?.msg ||
        err?.response?.msg ||
        err?.msg ||
        err?.error ||
        def;

  const normalizedMsg = normalizeErrKey(msg);

  if (ERROR_RESPONSE[normalizedMsg]) {
    return ERROR_RESPONSE[normalizedMsg].message;
  }

  // Axios special
  if (err?.errors && Array.isArray(err.errors) && err.errors.length > 0) {
    return err.errors[0].message;
  }

  // msg && console.log('error =>', msg);
  return replaceSensitiveText(normalizedMsg);
};

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
