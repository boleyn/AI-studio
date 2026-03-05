export interface ContextWindowUsage {
  model: string;
  usedTokens: number;
  maxContext: number;
  remainingTokens: number;
  usedPercent: number;
}
