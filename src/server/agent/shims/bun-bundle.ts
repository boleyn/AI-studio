export const feature = (name: string): boolean => {
  const normalized = String(name || '').trim();
  if (!normalized) return false;
  const exact = process.env[`CLAUDE_FEATURE_${normalized}`];
  if (exact === '1' || exact === 'true') return true;
  if (exact === '0' || exact === 'false') return false;
  const global = process.env.CLAUDE_FEATURES;
  if (!global) return false;
  const enabled = new Set(
    global
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return enabled.has(normalized);
};
