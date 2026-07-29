import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  cacheComponents: true,
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "playwright", "@citation-js/core", "@citation-js/plugin-csl"],
  // Keep each Git worktree isolated when multiple package-lock files exist.
  turbopack: { root: process.cwd() },
  // The local ChatGPT browser proxies the dev server through loopback.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  experimental: {
    instantNavigationDevToolsToggle: true,
    // On Windows this project's persistent Turbopack cache grew past 4 GB,
    // causing long cache compactions and excessive memory use in development.
    turbopackFileSystemCacheForDev: false,
  },
};

export default withNextIntl(nextConfig);
