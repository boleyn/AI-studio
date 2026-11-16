/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack(config) {
    const fileLoaderRule = config.module.rules.find(
      (rule) => rule.test && rule.test.test && rule.test.test(".svg")
    );

    if (fileLoaderRule) {
      fileLoaderRule.exclude = /\.svg$/i;
    }

    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      "@img/sharp-libvips-dev/include": false,
      "@img/sharp-libvips-dev/cplusplus": false,
      "@img/sharp-wasm32/versions": false,
    };

    config.module.rules.push({
      test: /\.svg$/i,
      issuer: /\.[jt]sx?$/,
      use: ["@svgr/webpack"],
    });

    config.module.rules.push({
      test: /\.txt$/i,
      type: "asset/source",
    });

    return config;
  },
};

module.exports = nextConfig;
