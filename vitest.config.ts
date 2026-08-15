import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      "$binding": fileURLToPath(new URL("./src/binding.ts", import.meta.url)),
      "@components": fileURLToPath(
        new URL("./src/components", import.meta.url),
      ),
      "$constants": fileURLToPath(
        new URL("./src/constants.ts", import.meta.url),
      ),
      "@contexts": fileURLToPath(new URL("./src/contexts", import.meta.url)),
      "@dialogs": fileURLToPath(new URL("./src/dialogs", import.meta.url)),
      "@layout": fileURLToPath(new URL("./src/layout", import.meta.url)),
      "$utils": fileURLToPath(new URL("./src/utils.ts", import.meta.url)),
    },
    conditions: ["development", "browser"],
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    server: {
      deps: {
        inline: ["@solid-primitives/scheduled"],
      },
    },
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/binding.ts",
        "src/index.tsx",
        "src/mountApp.tsx",
        "src/vite-env.d.ts",
        "src/test/**",
        "src/**/testUtils.{ts,tsx}",
        "src/**/*.test.{ts,tsx}",
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
