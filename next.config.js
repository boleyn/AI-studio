const path = require("path");
const webpack = require("webpack");

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    externalDir: true,
  },
  transpilePackages: [
    "@anthropic/ink",
    "@claude-code-best/agent-tools",
    "@claude-code-best/mcp-client",
    "@claude-code-best/builtin-tools",
    "@ant/computer-use-mcp",
    "@ant/claude-for-chrome-mcp",
    "@ant/computer-use-input",
    "@ant/computer-use-swift",
    "audio-capture-napi",
    "color-diff-napi",
    "image-processor-napi",
    "modifiers-napi",
    "url-handler-napi",
  ],
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
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      // Keep Claude Code's native import style (`src/...`) working after migration.
      src: path.resolve(__dirname, "src/server/agent"),
      'bun:bundle': path.resolve(__dirname, "src/server/agent/shims/bun-bundle.ts"),
      'bun:ffi': path.resolve(__dirname, "src/server/agent/shims/bun-ffi.ts"),
      '@anthropic/ink': path.resolve(__dirname, "src/server/agent/shims/anthropic-ink.ts"),
    };
    config.plugins = config.plugins || [];
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      (warning) => {
        const message =
          typeof warning === "string"
            ? warning
            : warning && typeof warning.message === "string"
            ? warning.message
            : "";
        return (
          message.includes("audio-capture-napi/src/index.ts") ||
          message.includes("Critical dependency: the request of a dependency is an expression")
        );
      },
    ];
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      "@img/sharp-libvips-dev/include": false,
      "@img/sharp-libvips-dev/cplusplus": false,
      "@img/sharp-wasm32/versions": false,
    };
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^bun:bundle$/,
        path.resolve(__dirname, "src/server/agent/shims/bun-bundle.ts")
      )
    );
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^bun:ffi$/,
        path.resolve(__dirname, "src/server/agent/shims/bun-ffi.ts")
      )
    );

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
