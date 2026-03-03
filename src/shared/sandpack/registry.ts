import type { SandpackSetup } from "@codesandbox/sandpack-react";

const DEFAULT_SANDPACK_REGISTRY_URL = "https://registry.npmmirror.com";

export const buildSandpackCustomSetup = (
  dependencies?: Record<string, string>
): SandpackSetup => {
  const setup: SandpackSetup = {
    npmRegistries: [
      {
        enabledScopes: [],
        limitToScopes: false,
        proxyEnabled: false,
        registryUrl: DEFAULT_SANDPACK_REGISTRY_URL,
      },
    ],
  };

  if (dependencies && Object.keys(dependencies).length > 0) {
    setup.dependencies = dependencies;
  }

  return setup;
};
