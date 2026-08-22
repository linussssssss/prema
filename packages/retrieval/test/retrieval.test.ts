import { describe, expect, it } from "vitest";
import { assertPublishedBefore, search } from "../src/index.ts";

describe("retrieval no-hindsight guard", () => {
  it("refuses to run without publishedBefore", async () => {
    await expect(search({ query: "x", publishedBefore: undefined as unknown as Date })).rejects.toThrow(
      /publishedBefore is required/,
    );
    expect(() => assertPublishedBefore({ publishedBefore: new Date("invalid") })).toThrow(/no-hindsight/);
  });

  it("accepts a valid cutoff (then hits the Phase 0 stub)", async () => {
    await expect(search({ query: "x", publishedBefore: new Date("2026-01-01") })).rejects.toThrow(/Phase 0 stub/);
  });
});
