export type FeishuRuntimeConfig = {
  enabled: boolean;
  appId: string;
  redirectUri: string;
};

let configPromise: Promise<FeishuRuntimeConfig> | null = null;

const defaultConfig: FeishuRuntimeConfig = {
  enabled: false,
  appId: "",
  redirectUri: "",
};

export const getFeishuRuntimeConfig = async (): Promise<FeishuRuntimeConfig> => {
  if (typeof window === "undefined") return defaultConfig;
  if (!configPromise) {
    configPromise = fetch("/api/auth/feishu/config")
      .then(async (res) => {
        if (!res.ok) return defaultConfig;
        const data = (await res.json().catch(() => null)) as FeishuRuntimeConfig | null;
        if (!data?.appId || !data?.redirectUri) return defaultConfig;
        return {
          enabled: Boolean(data.enabled),
          appId: data.appId,
          redirectUri: data.redirectUri,
        };
      })
      .catch(() => defaultConfig);
  }
  return configPromise;
};
