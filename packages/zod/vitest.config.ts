import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    passWithNoTests: true,
    typecheck: {
      enabled: true,
      include: ["**/*.test-d.ts"],
    },
  },
});
