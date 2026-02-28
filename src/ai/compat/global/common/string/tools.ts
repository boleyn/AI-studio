export { getNanoid } from '@/global/common/string/tools';

export const sliceJsonStr = (input: string, maxLen = 4000) => {
  if (input.length <= maxLen) return input;
  return input.slice(0, maxLen);
};

export const replaceVariable = (text: string, variables: Record<string, string>) => {
  return Object.entries(variables).reduce((acc, [key, value]) => {
    return acc.replaceAll(`{{${key}}}`, value);
  }, text);
};
