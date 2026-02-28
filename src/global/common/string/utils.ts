export const isObjectId = (value?: string) => {
  if (!value) return false;
  return /^[a-fA-F0-9]{24}$/.test(value);
};
