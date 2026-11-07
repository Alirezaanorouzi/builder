import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd()),
  serverExternalPackages: ["@cursor/sdk", "undici"],
  // Keep the SDK in the Liara standalone image (webpack does not bundle it).
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@cursor/sdk/**/*",
      "./src/lib/db/**/*",
      "./prisma-postinstall.mjs",
      "./prisma-assets.mjs",
      "./scripts/apply-embedded-migrations.mjs",
      "./node_modules/prisma/**/*",
      "./node_modules/@prisma/engines/**/*",
    ],
  },
  webpack: (config, { webpack }) => {
    config.plugins.push(
      new webpack.IgnorePlugin({ resourceRegExp: /\.d\.ts\.map$/ })
    );
    config.module.rules.unshift({
      test: /\.d\.ts\.map$/,
      type: "json",
    });
    return config;
  },
};

export default nextConfig;
