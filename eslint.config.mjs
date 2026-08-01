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
    // `mastra dev` bundles src/mastra to here — 20MB of generated output that
    // linting has no opinion worth having about, and enough of it to exhaust
    // the heap.
    ".mastra/**",
  ]),
]);

export default eslintConfig;
