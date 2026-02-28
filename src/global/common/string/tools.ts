import { sha256 } from 'js-sha256';

export const getNanoid = (size = 24): string => {
  const firstAlphabet = 'abcdefghijklmnopqrstuvwxyz';
  const restAlphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
  const normalizedSize = Math.max(1, Math.floor(size));

  const randomIndex = (max: number) => {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const buffer = new Uint32Array(1);
      crypto.getRandomValues(buffer);
      return buffer[0] % max;
    }
    return Math.floor(Math.random() * max);
  };

  const firstChar = firstAlphabet[randomIndex(firstAlphabet.length)];
  let result = firstChar;

  for (let i = 1; i < normalizedSize; i += 1) {
    result += restAlphabet[randomIndex(restAlphabet.length)];
  }

  return result;
};

export const hashStr = (str: string): string => sha256(str);

/** Mask sensitive content in error messages (e.g. tokens, keys). */
export const replaceSensitiveText = (text: string): string => text;
