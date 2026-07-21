export {};

const isTruthy = (value: string | undefined): boolean =>
  value === "1" || value === "true" || value === "yes" || value === "on";

export const isSkillSearchEnabled: () => boolean = () => {
  const exact = process.env.CLAUDE_FEATURE_EXPERIMENTAL_SKILL_SEARCH;
  if (exact === "0" || exact === "false") return false;
  if (isTruthy(exact)) return true;

  const global = process.env.CLAUDE_FEATURES || "";
  if (!global.trim()) return false;
  return global
    .split(",")
    .map((s) => s.trim())
    .some((s) => s === "EXPERIMENTAL_SKILL_SEARCH");
};
