export interface ContextWindowUsage {
  model: string;
  totalPromptTokens?: number;
  currentInputTokens?: number;
  usedTokens: number;
  maxContext: number;
  remainingTokens: number;
  usedPercent: number;
  budget?: {
    systemAndSkillsTokens: number;
    historyTokens: number;
    historyFileTokens: number;
    toolsSchemaTokens: number;
    backgroundTokens: number;
    currentInputTokens: number;
    totalPromptTokens: number;
    reservedOutputTokens: number;
  };
}
