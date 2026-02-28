export const formatModelChars2Points = ({
  model,
  inputTokens = 0,
  outputTokens = 0
}: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}) => {
  return {
    modelName: model,
    totalPoints: inputTokens + outputTokens
  };
};
