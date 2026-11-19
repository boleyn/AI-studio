/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack(config, { webpack }) {
    // libarchive ships a minified module worker as a static asset. SWC treats
    // emitted .js assets as scripts when minifying them again.
    config.plugins.push({
      apply(compiler) {
        compiler.hooks.thisCompilation.tap("PreserveLibarchiveWorker", (compilation) => {
          compilation.hooks.processAssets.tap(
            { name: "PreserveLibarchiveWorker", stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE - 1 },
            () => {
              for (const { name, info } of compilation.getAssets()) {
                if (info.sourceFilename?.endsWith("libarchive.js/dist/worker-bundle.js")) {
                  compilation.updateAsset(name, (source) => source, { minimized: true });
                }
              }
            },
          );
        });
      },
    });

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
