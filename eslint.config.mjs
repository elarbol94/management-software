import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local tooling and vault data are not application source.
    ".claude/worktrees/**",
    ".obsidian/**",
    ".cache/**",
    // Generated third-party browser assets are copied verbatim from npm packages.
    "public/vendor/**",
  ]),
]);

export default eslintConfig;
