import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The dev indicator sits bottom-left, over the sidebar's user menu, and its portal
  // swallows clicks aimed at it. Hidden for end-to-end runs only; compile and runtime
  // errors are still surfaced.
  ...(process.env.E2E_TEST === "true" ? { devIndicators: false as const } : {}),
  output: "standalone",
  // sqlite-vec ships a native .so and @huggingface/transformers loads onnxruntime
  // bindings; both must stay out of the bundle and be required at runtime.
  serverExternalPackages: ["better-sqlite3", "playwright", "@citation-js/core", "@citation-js/plugin-csl", "sqlite-vec", "@huggingface/transformers"],
  // Keep each Git worktree isolated when multiple package-lock files exist.
  turbopack: { root: process.cwd() },
  // The local ChatGPT browser proxies the dev server through loopback.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  // The files under public/data are content-versioned by name (schema version plus the
  // year range they cover), so a changed dataset is a changed URL. Without this they are
  // served no-store and every page load re-fetches ~10 MB of national statistics.
  async headers() {
    return [{
      source: "/data/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }];
  },
  experimental: {
    instantNavigationDevToolsToggle: true,
    // On Windows this project's persistent Turbopack cache grew past 4 GB,
    // causing long cache compactions and excessive memory use in development.
    turbopackFileSystemCacheForDev: false,
  },
};

export default withNextIntl(nextConfig);
