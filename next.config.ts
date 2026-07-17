import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // Keep each Git worktree isolated when multiple package-lock files exist.
  turbopack: { root: process.cwd() },
};

export default withNextIntl(nextConfig);
