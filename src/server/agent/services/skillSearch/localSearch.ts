import memoize from "lodash-es/memoize.js";
import type { Command } from "../../types/command.js";
import { getSkillToolCommands } from "../../commands.js";

export type SkillSearchCandidate = {
  name: string;
  description: string;
};

const normalize = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9\s:_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (input: string): string[] =>
  normalize(input)
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);

const toCandidate = (cmd: Command): SkillSearchCandidate => ({
  name: cmd.name,
  description: [cmd.description || "", cmd.whenToUse || ""].filter(Boolean).join(" - "),
});

const getSkillIndex = memoize(async (cwd: string): Promise<SkillSearchCandidate[]> => {
  const commands = await getSkillToolCommands(cwd);
  return commands
    .filter((cmd) => cmd.type === "prompt")
    .map(toCandidate);
});

const scoreCandidate = (queryTokens: string[], candidate: SkillSearchCandidate): number => {
  if (queryTokens.length === 0) return 0;
  const nameNorm = normalize(candidate.name);
  const descNorm = normalize(candidate.description);
  const haystack = `${nameNorm} ${descNorm}`.trim();
  if (!haystack) return 0;

  let score = 0;
  for (const token of queryTokens) {
    if (!token) continue;
    if (nameNorm === token) score += 8;
    else if (nameNorm.includes(token)) score += 5;
    else if (descNorm.includes(token)) score += 2;
  }

  if (score > 0 && nameNorm.includes(queryTokens.join(" "))) score += 3;
  return score;
};

export const searchSkills = async (
  cwd: string,
  query: string,
  limit = 6
): Promise<SkillSearchCandidate[]> => {
  const index = await getSkillIndex(cwd);
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  return index
    .map((candidate) => ({ candidate, score: scoreCandidate(tokens, candidate) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name))
    .slice(0, Math.max(1, Math.min(limit, 12)))
    .map((item) => item.candidate);
};

export const clearSkillIndexCache: () => void = () => {
  getSkillIndex.cache?.clear?.();
};
