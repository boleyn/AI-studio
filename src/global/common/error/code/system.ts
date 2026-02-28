import { type ErrType } from '../errorCode';
/* dataset: 509000 */
export enum SystemErrEnum {
  communityVersionNumLimit = 'communityVersionNumLimit',
  licenseAppAmountLimit = 'licenseAppAmountLimit',
  licenseDatasetAmountLimit = 'licenseDatasetAmountLimit',
  licenseUserAmountLimit = 'licenseUserAmountLimit'
}

const systemErr = [
  { statusText: SystemErrEnum.communityVersionNumLimit, message: '社区版数量限制' },
  { statusText: SystemErrEnum.licenseAppAmountLimit, message: '许可应用数量限制' },
  { statusText: SystemErrEnum.licenseDatasetAmountLimit, message: '许可知识库数量限制' },
  { statusText: SystemErrEnum.licenseUserAmountLimit, message: '许可用户数量限制' }
];

export default systemErr.reduce((acc, cur, index) => {
  return {
    ...acc,
    [cur.statusText]: {
      code: 509000 + index,
      statusText: cur.statusText,
      message: cur.message,
      data: null
    }
  };
}, {} as ErrType<`${SystemErrEnum}`>);
