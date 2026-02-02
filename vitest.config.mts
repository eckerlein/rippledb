import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*/", "tests/*/", "apps/*/", "examples/*/"],
    passWithNoTests: true,
    pool: "threads",
  },
});
