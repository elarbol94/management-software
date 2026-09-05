import { createRequire } from "node:module";
import type { ReactNode } from "react";

// Downloadable HTML is an artifact, not a Next.js page or an RSC response. Resolve the
// Node renderer outside the route's react-server condition (which exports a throwing
// stub). React/ReactDOM are already runtime dependencies in the standalone deployment.
const nodeRequire = createRequire(import.meta.url);
export function renderStaticHtml(node: ReactNode): string {
  const renderer = nodeRequire("react-dom/server") as typeof import("react-dom/server");
  return renderer.renderToStaticMarkup(node);
}
