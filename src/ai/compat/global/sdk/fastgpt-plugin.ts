export type I18nStringStrictType = {
  en: string;
  "zh-CN": string;
  "zh-Hant": string;
};

export type AiproxyMapProviderType = Record<
  string,
  {
    name: I18nStringStrictType;
    provider: string;
    avatar: string;
  }
>;
