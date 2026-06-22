import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./"),
      "@datum/core": resolve(__dirname, "../../packages/core/src"),
      "server-only": resolve(__dirname, "tests/__mocks__/server-only.ts"),
    },
  },
});
