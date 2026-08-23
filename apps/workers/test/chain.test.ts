import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getAddress, isAddress, keccak256, stringToHex } from "viem";
import { auditLog, createDb, ingestState, verifyAuditChain, type DbHandle } from "@verdict/schema";
import { forEachAdaptiveRange, makeClient } from "../src/chain/client.ts";
import { chainStateKey, resetChainCursor } from "../src/chain/indexer.ts";
import { ETHEREUM_CONTRACTS, oracleLabelFor, POLYGON_CONTRACTS } from "../src/chain/config.ts";

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

  it("stores every address EIP-55 checksummed", () => {
    // Regression guard (ADR-0014): viem throws "Address ... is invalid" on a
    // mixed-case literal whose checksum doesn't match, so a mis-cased address
    // breaks every readContract against it while getLogs — which lowercases
    // first — keeps working. That asymmetry hid the V4 oracle for a day.
    for (const [name, address] of [...Object.entries(POLYGON_CONTRACTS), ...Object.entries(ETHEREUM_CONTRACTS)]) {
      if (typeof address !== "string") continue;
      expect(isAddress(address, { strict: true }), `${name} should be ${getAddress(address.toLowerCase())}`).toBe(true);
    }
  });

  it("derives questionID the way UmaCtfAdapter does (keccak256 of ancillary bytes)", () => {
    // Sanity pin: the join rule disputes→markets relies on this equality.
    const ancillary = stringToHex("q: title: Will it rain tomorrow?");
    expect(keccak256(ancillary)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("makeClient transport selection (ADR-0013)", () => {
  const saved = { primary: process.env.POLYGON_RPC_URL, fallback: process.env.POLYGON_RPC_URL_FALLBACK };

  beforeEach(() => {
    process.env.POLYGON_RPC_URL = "https://primary.example/rpc";
    process.env.POLYGON_RPC_URL_FALLBACK = "https://secondary.example/rpc";
  });

  afterEach(() => {
    if (saved.primary === undefined) delete process.env.POLYGON_RPC_URL;
    else process.env.POLYGON_RPC_URL = saved.primary;
    if (saved.fallback === undefined) delete process.env.POLYGON_RPC_URL_FALLBACK;
    else process.env.POLYGON_RPC_URL_FALLBACK = saved.fallback;
  });

  it("uses a fallback transport by default (live head-tailing)", () => {
    expect(makeClient("polygon").transport.type).toBe("fallback");
  });

  it("uses the primary URL alone when primaryOnly (deep backfill)", () => {
    // Alchemy free caps getLogs at ~10 blocks: failing over to it mid-sweep
    // can't serve the range, it only burns retries.
    const transport = makeClient("polygon", { primaryOnly: true }).transport;
    expect(transport.type).toBe("http");
    expect(transport.url).toBe("https://primary.example/rpc");
  });

  it("still builds a client when primaryOnly is asked for without a primary key", () => {
    delete process.env.POLYGON_RPC_URL;
    const transport = makeClient("polygon", { primaryOnly: true }).transport;
    expect(transport.type).toBe("http");
    expect(transport.url).toBe("https://secondary.example/rpc");
  });
});

describe("resetChainCursor (PGlite)", () => {
  // One migrated instance for the suite: booting PGlite costs seconds, and the
  // two cases touch different chains so they don't interfere.
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createDb("pglite://memory");
    await handle.migrate();
  });

  afterAll(async () => {
    await handle.close();
  });

  it("deletes the stored cursor, reports it, and records the reset in the audit log", async () => {
    const key = chainStateKey("polygon");
    expect(key).toBe("chain:polygon:lastBlock");
    await handle.db.insert(ingestState).values({ key, value: { lastBlock: "61900000" }, updatedAt: new Date() });

    const result = await resetChainCursor(handle.db, "polygon");

    expect(result.previousBlock).toBe("61900000");
    expect(await handle.db.select().from(ingestState).where(eq(ingestState.key, key))).toHaveLength(0);
    const audit = await handle.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "index.cursor.reset"), eq(auditLog.entityId, "polygon")));
    expect(audit).toHaveLength(1);
    expect(await verifyAuditChain(handle.db)).toBeNull(); // hash chain intact
  });

  it("is a no-op when no cursor is stored", async () => {
    const result = await resetChainCursor(handle.db, "ethereum");
    expect(result.previousBlock).toBeNull();
    expect(result.key).toBe("chain:ethereum:lastBlock");
  });
});
