import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    testTimeout: 20_000
  },
  resolve: {
    alias: {
      "@agentbase/core": here("./packages/core/src/index.ts"),
      "@agentbase/trace": here("./packages/trace/src/index.ts"),
      "@agentbase/context-default": here("./packages/context-default/src/index.ts"),
      "@agentbase/guardrails": here("./packages/guardrails/src/index.ts"),
      "@agentbase/memory": here("./packages/memory/src/index.ts"),
      "@agentbase/patterns": here("./packages/patterns/src/index.ts"),
      "@agentbase/tools-fs": here("./packages/tools-fs/src/index.ts"),
      "@agentbase/tools-shell": here("./packages/tools-shell/src/index.ts")
    }
  }
});
