export type DiscoverySignalType =
  | 'turn_zero_user_input'
  | 'assistant_turn_prefetch';

export type DiscoverySignal = {
  type: DiscoverySignalType;
  query: string;
  generatedAt: string;
};

export const createDiscoverySignal = (
  type: DiscoverySignalType,
  query: string
): DiscoverySignal => ({
  type,
  query,
  generatedAt: new Date().toISOString(),
});
