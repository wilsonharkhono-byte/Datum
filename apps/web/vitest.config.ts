import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    server: {
      deps: {
        // server-only throws at import-time in non-Next.js environments;
        // mock it so pure helpers can be unit-tested without a full Next.js runtime.
        inline: ["server-only"],
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./"),
      "server-only": resolve(__dirname, "tests/__mocks__/server-only.ts"),
    },
  },
});
