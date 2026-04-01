export type AuthUser = {
  id: string;
  username: string;
  displayName?: string;
  contact?: string;
  avatar?: string;
  primaryModel?: string;
  provider?: string;
};
