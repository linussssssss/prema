import { describe, expect, it } from "vitest";
import { createLlmRouter, modelVersion, promptHash } from "../src/index.ts";

describe("llm stub", () => {
  it("model versions are deterministic and prompt-sensitive", () => {
    const a = modelVersion("claude-sonnet-5", "sys", "prompt");
    expect(a).toBe(modelVersion("claude-sonnet-5", "sys", "prompt"));
    expect(a).not.toBe(modelVersion("claude-sonnet-5", "sys", "prompt2"));
    expect(a).toMatch(/^claude-sonnet-5#[0-9a-f]{16}$/);
    expect(promptHash("a", "b")).toHaveLength(16);
  });

  it("refuses to make calls in Phase 0", async () => {
    const router = createLlmRouter();
    await expect(async () =>
      router.structured({ system: "s", prompt: "p", schema: null as never }),
    ).rejects.toThrow(/Phase 0 stub/);
    expect(router.totalCostUsd()).toBe(0);
  });
});
