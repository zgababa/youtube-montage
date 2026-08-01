import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  /**
   * The pipeline's native half. These reach for `node:` builtins, ship their own
   * binaries, or load addons at runtime — all of which the Next bundler either
   * breaks or bloats. Keep them as plain Node requires on the server.
   */
  serverExternalPackages: [
    "@mastra/core",
    "@mastra/libsql",
    "@libsql/client",
    "playwright",
    "playwright-core",
    "openai",
  ],
}

export default nextConfig
