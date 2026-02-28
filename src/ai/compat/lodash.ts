export const cloneDeep = <T>(input: T): T => {
  try {
    return JSON.parse(JSON.stringify(input));
  } catch {
    return input;
  }
};
