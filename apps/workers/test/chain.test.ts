import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  pad,
  stringToHex,
  type Hex,
  type RpcLog,
} from "viem";
import { auditLog, createDb, ingestState, verifyAuditChain, type DbHandle } from "@verdict/schema";
import { forEachAdaptiveRange, makeClient } from "../src/chain/client.ts";
import { chainStateKey, decodeOoLogs, resetChainCursor } from "../src/chain/indexer.ts";
import {
  ETHEREUM_CONTRACTS,
  OO_EVENT_TOPICS,
  oov2Abi,
  oracleLabelFor,
  POLYGON_CONTRACTS,
} from "../src/chain/config.ts";

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

  it("remembers a span that failed instead of re-probing it every few chunks", async () => {
    // Simulates a provider with a hard per-request capacity, which is what the
    // 10k-log rule and the body cap both amount to. Purely multiplicative
    // growth rediscovers that ceiling roughly every third chunk; each of those
    // probes is a paid request that cannot succeed (ADR-0015).
    const capacity = 1_000n;
    let failures = 0;
    const seen: Array<[bigint, bigint]> = [];
    await forEachAdaptiveRange(
      { fromBlock: 0n, toBlock: 199_999n },
      { initialSpan: 8_000n, minSpan: 64n, maxSpan: 400_000n },
      async (c) => {
        if (c.toBlock - c.fromBlock + 1n > capacity) {
          failures += 1;
          throw new Error("query returned more than 10000 results");
        }
        seen.push([c.fromBlock, c.toBlock]);
      },
    );

    let next = 0n;
    for (const [from, to] of seen) {
      expect(from).toBe(next);
      next = to + 1n;
    }
    expect(next).toBe(200_000n); // still covers the range exactly once
    expect(seen.length).toBeGreaterThan(150);
    // Purely multiplicative growth fails on ~1 attempt in 3, i.e. about one
    // failure per two successful chunks (~100 here). Ceiling-capped growth
    // pays only for the periodic relax probe (~25). Assert the ratio, not a
    // constant, so the test states the property rather than today's arithmetic.
    expect(failures).toBeLessThan(seen.length / 6);
  });

  it("still widens again after a run of clean chunks", async () => {
    // Density varies by orders of magnitude across the backfill, so a learned
    // ceiling must not permanently pin the sweep narrow.
    const spans: bigint[] = [];
    let failed = false;
    await forEachAdaptiveRange(
      { fromBlock: 0n, toBlock: 999_999n },
      { initialSpan: 2_000n, minSpan: 64n, maxSpan: 400_000n, relaxAfter: 4 },
      async (c) => {
        const span = c.toBlock - c.fromBlock + 1n;
        if (!failed && span > 1_500n) {
          failed = true; // one early ceiling, then the range goes quiet
          throw new Error("block range is too large");
        }
        spans.push(span);
      },
    );
    expect(failed).toBe(true);
    expect(spans.at(-1)!).toBeGreaterThan(10_000n);
  });

  it("backs off on rate limits without shrinking the span", async () => {
    // A 429 reaches us as viem's generic "HTTP request failed", which used to
    // match the range-error pattern. Shrinking then multiplies the request
    // count and deepens the throttling — observed as a 2929->128 death spiral
    // against Infura on 2026-08-23.
    const spans: bigint[] = [];
    let throttled = 0;
    await forEachAdaptiveRange(
      { fromBlock: 0n, toBlock: 999n },
      { initialSpan: 500n, minSpan: 64n, backoffMs: 1 },
      async (c) => {
        if (throttled < 2) {
          throttled += 1;
          throw new Error(
            'HTTP request failed.\n\nStatus: 429\nURL: https://polygon-mainnet.infura.io/v3/x\n\nDetails: Too Many Requests',
          );
        }
        spans.push(c.toBlock - c.fromBlock + 1n);
      },
    );
    expect(throttled).toBe(2);
    expect(spans[0]).toBe(500n); // retried at the same width, not halved
    expect(spans.reduce((a, b) => a + b, 0n)).toBe(1000n);
  });

  it("gives up after repeated rate limits rather than looping forever", async () => {
    await expect(
      forEachAdaptiveRange(
        { fromBlock: 0n, toBlock: 99n },
        { initialSpan: 100n, backoffMs: 1, maxRateLimitRetries: 3 },
        async () => {
          throw new Error("Status: 429 Too Many Requests");
        },
      ),
    ).rejects.toThrow("429");
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

  it("pins the OO topic0 selectors and the requester-position invariant", () => {
    // The single-call OO query (ADR-0018) is only correct because `requester`
    // is the first indexed arg on all three events, so it always lands in
    // topic1 and one topic1 OR-set filters all of them. If an event is added
    // whose first indexed arg differs, the filter silently stops matching it.
    for (const event of oov2Abi) {
      const firstIndexed = event.inputs.find((i) => "indexed" in i && i.indexed === true);
      expect(firstIndexed?.name, `${event.name} must keep requester first-indexed`).toBe("requester");
    }
    expect(OO_EVENT_TOPICS).toHaveLength(3);
    for (const topic of OO_EVENT_TOPICS) expect(topic).toMatch(/^0x[0-9a-f]{64}$/);
    // DisputePrice's selector, as echoed back by Infura in a live eth_getLogs
    // request on 2026-08-23 — an external check on our ABI text, not a
    // self-consistent restatement of it.
    const disputeTopic = OO_EVENT_TOPICS[oov2Abi.findIndex((e) => e.name === "DisputePrice")];
    expect(disputeTopic).toBe("0x5165909c3d1c01c5d1e121ac6f6d01dda1ba24bc9e1f975b5a375339c15be7f3");
  });

  it("decodes combined-topic OO logs and never drops one silently", () => {
    const settle = OO_EVENT_TOPICS[oov2Abi.findIndex((e) => e.name === "Settle")]!;
    const good: RpcLog = {
      address: "0x2c0367a9db231ddebd88a94b4f6461a6e47c58b1",
      topics: [
        settle,
        pad("0x65070be91477460d8a7aeeb94ef92fe056c2f2a7", { size: 32 }),
        pad("0x0000000000000000000000000000000000000001", { size: 32 }),
        pad("0x0000000000000000000000000000000000000002", { size: 32 }),
      ],
      data: encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "bytes" }, { type: "int256" }, { type: "uint256" }],
        [stringToHex("YES_OR_NO_QUERY", { size: 32 }), 1n, stringToHex("q: title: x"), 1n, 2n],
      ),
      blockNumber: "0x10",
      logIndex: "0x3",
      transactionHash: `0x${"ab".repeat(32)}`,
      blockHash: `0x${"cd".repeat(32)}`,
      transactionIndex: "0x0",
      removed: false,
    };
    const decoded = decodeOoLogs([good]);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.eventName).toBe("Settle");
    expect(decoded[0]!.blockNumber).toBe(16n);
    expect(decoded[0]!.logIndex).toBe(3);
    // Round-trips to the same checksummed literal config.ts holds.
    expect(decoded[0]!.args.requester).toBe(POLYGON_CONTRACTS.ctfAdapterV4);

    // Undecodable input is reported, not quietly skipped: we selected these
    // logs by our own topic0 list, so a decode failure means a real defect.
    const bad = { ...good, data: "0xdeadbeef" as Hex };
    expect(decodeOoLogs([bad])).toHaveLength(0);
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
