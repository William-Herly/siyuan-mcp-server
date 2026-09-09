import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/behavior/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"]
  }
});
