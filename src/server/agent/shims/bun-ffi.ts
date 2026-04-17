export const FFIType = {
  i32: "i32",
  u64: "u64",
} as const;

export const dlopen = () => {
  throw new Error("bun:ffi is not available in this runtime");
};

