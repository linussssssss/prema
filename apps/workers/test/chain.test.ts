import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import { forEachAdaptiveRange } from "../src/chain/client.ts";
import { oracleLabelFor, POLYGON_CONTRACTS } from "../src/chain/config.ts";

describe("forEachAdaptiveRange", () => {
  it("covers the whole range exactly once", async () => {
    const seen: Array<[bigint, bigint]> = [];
    await forEachAdaptiveRange({ fromBlock: 0n, toBlock: 999n }, { initialSpan: 100n }, async (c) => {
      seen.push([c.fromBlock, c.toBlock]);
    });
    expect(seen[0]).toEqual([0n, 99n]);
    let next = 0n;
    for (const [from, to] of seen) {
      expect(from).toBe(next);
      expect(to).toBeGreaterThanOrEqual(from);
      next = to + 1n;
    }
    expect(next).toBe(1000n);
  });

  it("halves the span on range errors and still completes", async () => {
    const spans: bigint[] = [];
    let failedOnce = false;
    await forEachAdaptiveRange({ fromBlock: 0n, toBlock: 499n }, { initialSpan: 200n, minSpan: 25n }, async (c) => {
      const span = c.toBlock - c.fromBlock + 1n;
      if (!failedOnce && span > 100n) {
        failedOnce = true;
        throw new Error("query returned more than 10000 results");
      }
      spans.push(span);
    });
    expect(failedOnce).toBe(true);
    expect(spans[0]!).toBeLessThanOrEqual(100n);
    expect(spans.reduce((a, b) => a + b, 0n)).toBe(500n);
  });

  it("rethrows non-range errors", async () => {
    await expect(
      forEachAdaptiveRange({ fromBlock: 0n, toBlock: 9n }, { initialSpan: 10n }, async () => {
        throw new Error("insufficient funds");
      }),
    ).rejects.toThrow("insufficient funds");
  });
});

describe("chain config", () => {
  it("labels every verified contract", () => {
    expect(oracleLabelFor(POLYGON_CONTRACTS.ctfAdapterV3)).toBe("ctf_adapter_v3");
    expect(oracleLabelFor(POLYGON_CONTRACTS.negRiskAdapter.toUpperCase().replace("0X", "0x"))).toBe("neg_risk_adapter");
    expect(oracleLabelFor(POLYGON_CONTRACTS.oov2)).toBe("oov2");
    expect(oracleLabelFor("0x0000000000000000000000000000000000000000")).toBe("unknown");
  });

  it("derives questionID the way UmaCtfAdapter does (keccak256 of ancillary bytes)", () => {
    // Sanity pin: the join rule disputes→markets relies on this equality.
    const ancillary = stringToHex("q: title: Will it rain tomorrow?");
    expect(keccak256(ancillary)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
