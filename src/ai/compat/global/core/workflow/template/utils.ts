type HandleConfigOptions = {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
};

export const getHandleConfig = (
  top = true,
  right = true,
  bottom = true,
  left = true
): HandleConfigOptions => ({
  top,
  right,
  bottom,
  left
});
