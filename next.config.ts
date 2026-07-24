import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  cacheComponents: true,
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "playwright"],
  // Keep each Git worktree isolated when multiple package-lock files exist.
  turbopack: { root: process.cwd() },
  // The local ChatGPT browser proxies the dev server through loopback.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  experimental: {
    instantNavigationDevToolsToggle: true,
  },
};

export default withNextIntl(nextConfig);
