import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd()),
  serverExternalPackages: ["@cursor/sdk"],
  webpack: (config) => {
    config.module.rules.unshift({
      test: /\.d\.ts\.map$/,
      type: "json",
    });
    return config;
  },
};

export default nextConfig;
