import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow dev resources (HMR, lazy chunks) when the dev server is opened
  // via 127.0.0.1 instead of localhost.
  allowedDevOrigins: ["127.0.0.1"],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
  turbopack: {
    root: __dirname,
    resolveAlias: {
      canvas: "./src/lib/empty-module.js",
    },
  },
  serverExternalPackages: ["pdfkit"],
  /* config options here */
};

export default nextConfig;
