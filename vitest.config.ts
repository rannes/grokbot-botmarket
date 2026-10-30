import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "hono/jsx",
  },
  test: {
    environment: "node",
    pool: "forks",
    poolOptions: { forks: { execArgv: ["--no-warnings=ExperimentalWarning"] } },
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
