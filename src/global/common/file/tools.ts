export const formatFileSize = (size: number): string => {
  if (!Number.isFinite(size) || size < 0) return "0B";
  if (size < 1024) return `${size}B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)}GB`;
};
