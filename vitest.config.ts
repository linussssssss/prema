import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/test/**/*.test.ts",
      "apps/**/test/**/*.test.ts",
      "data/test/**/*.test.ts",
    ],
    testTimeout: 30_000,
    // PGlite boot + migrate runs in beforeAll/beforeEach and takes seconds on a
    // cold Windows box; the 10s default made those hooks flaky as suites were
    // added. Same reasoning as testTimeout above.
    hookTimeout: 30_000,
  },
});
