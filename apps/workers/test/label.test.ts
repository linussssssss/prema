import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { desc, eq } from "drizzle-orm";
import {
  ambiguityLabels,
  createDb,
  disputes,
  markets,
  resolutionEvents,
  rulesVersions,
  venues,
  verifyAuditChain,
  type DbHandle,
} from "@verdict/schema";
import { computeLabels, isFiftyFifty } from "../src/label/compute.ts";

describe("isFiftyFifty", () => {
  it("detects equal-split payout vectors", () => {
    expect(isFiftyFifty(["1", "1"])).toBe(true);
    expect(isFiftyFifty([1, 1])).toBe(true);
    expect(isFiftyFifty(["1", "0"])).toBe(false);
    expect(isFiftyFifty(["0", "1"])).toBe(false);
    expect(isFiftyFifty([])).toBe(false);
    expect(isFiftyFifty(null)).toBe(false);
    expect(isFiftyFifty(["0", "0"])).toBe(false);
  });
});

describe("computeLabels (PGlite end-to-end)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createDb("pglite://memory");
    await handle.migrate();
    const db = handle.db;
    await db.insert(venues).values({ id: "polymarket", name: "Polymarket", kind: "onchain" });

    const base = {
      venueId: "polymarket",
      capturedAt: new Date(),
      listedAt: new Date("2024-03-01T00:00:00Z"),
      closed: true,
      active: false,
    };
    await db.insert(markets).values([
      { ...base, id: "polymarket:m1", externalId: "m1", question: "clean market", questionId: "0xq1", conditionId: "0xc1" },
      { ...base, id: "polymarket:m2", externalId: "m2", question: "disputed market", questionId: "0xq2", conditionId: "0xc2" },
      { ...base, id: "polymarket:m3", externalId: "m3", question: "na market", questionId: "0xq3", conditionId: "0xc3" },
      { ...base, id: "polymarket:m4", externalId: "m4", question: "edited market", questionId: "0xq4", conditionId: "0xc4" },
      { ...base, id: "polymarket:m5", externalId: "m5", question: "escalated market", questionId: "0xq5", conditionId: "0xc5" },
    ]);

    const ver = (marketId: string, versionNum: number, text: string) => ({
      marketId,
      versionNum,
      textHash: `hash-${marketId}-${versionNum}`,
      rulesText: text,
      source: "gamma_description",
      occurredAt: new Date("2024-03-02T00:00:00Z"),
      capturedAt: new Date(),
    });
    await db.insert(rulesVersions).values([
      ver("polymarket:m1", 1, "clean"),
      ver("polymarket:m4", 1, "original"),
      ver("polymarket:m4", 2, "edited"),
    ]);

    const evBase = { chain: "polygon", capturedAt: new Date(), blockNumber: 1, blockTime: new Date("2024-06-01T12:00:00Z") };
    await db.insert(resolutionEvents).values([
      // m2: disputed, settled without escalation
      {
        ...evBase,
        contractAddress: "0xoo",
        oracle: "oov2",
        eventName: "DisputePrice",
        txHash: "0xt1",
        logIndex: 1,
        questionId: "0xq2",
        args: { timestamp: "1717243200", proposedPrice: "1000000000000000000", proposer: "0xP", disputer: "0xD" },
      },
      {
        ...evBase,
        contractAddress: "0xoo",
        oracle: "oov2",
        eventName: "Settle",
        txHash: "0xt2",
        logIndex: 2,
        questionId: "0xq2",
        args: { timestamp: "1717243200", price: "0" },
      },
      // m3: resolved 50/50 on-chain
      {
        ...evBase,
        contractAddress: "0xctf",
        oracle: "ctf",
        eventName: "ConditionResolution",
        txHash: "0xt3",
        logIndex: 1,
        questionId: "0xq3",
        conditionId: "0xc3",
        args: { payoutNumerators: ["1", "1"], outcomeSlotCount: "2" },
      },
      // m5: disputed and escalated to the DVM
      {
        ...evBase,
        contractAddress: "0xoo",
        oracle: "oov2",
        eventName: "DisputePrice",
        txHash: "0xt4",
        logIndex: 1,
        questionId: "0xq5",
        args: { timestamp: "1720000000", proposedPrice: "0", proposer: "0xP", disputer: "0xD" },
      },
      {
        ...evBase,
        chain: "ethereum",
        contractAddress: "0xvoting",
        oracle: "votingv2",
        eventName: "RequestResolved",
        txHash: "0xt5",
        logIndex: 1,
        questionId: null,
        args: { time: "1720000000", price: "1000000000000000000" },
      },
    ]);
  });

  afterAll(async () => handle.close());

  it("computes the composite contested label", async () => {
    const stats = await computeLabels(handle.db);
    expect(stats.marketsLabeled).toBe(5);
    expect(stats.disputedMarkets).toBe(2); // m2, m5
    expect(stats.escalatedMarkets).toBe(1); // m5
    expect(stats.resolvedNaMarkets).toBe(1); // m3
    expect(stats.rulesEditedMarkets).toBe(1); // m4
    expect(stats.contestedMarkets).toBe(4); // all but m1

    const labelOf = async (id: string) => {
      const rows = await handle.db
        .select()
        .from(ambiguityLabels)
        .where(eq(ambiguityLabels.marketId, id))
        .orderBy(desc(ambiguityLabels.id))
        .limit(1);
      return rows[0]!;
    };
    expect((await labelOf("polymarket:m1")).contested).toBe(false);
    const m2 = await labelOf("polymarket:m2");
    expect(m2.disputed).toBe(true);
    expect(m2.escalated).toBe(false);
    expect(m2.contested).toBe(true);
    expect((await labelOf("polymarket:m3")).resolvedNa).toBe(true);
    expect((await labelOf("polymarket:m4")).rulesEditedAfterListing).toBe(true);
    const m5 = await labelOf("polymarket:m5");
    expect(m5.escalated).toBe(true);

    const disputeRows = await handle.db.select().from(disputes);
    expect(disputeRows).toHaveLength(2);
    const m2Dispute = disputeRows.find((d) => d.marketId === "polymarket:m2")!;
    expect(m2Dispute.settledPrice).toBe("0");
    expect(m2Dispute.escalated).toBe(false);
  });

  it("is idempotent: rerun appends no new label rows and keeps the audit chain intact", async () => {
    const before = (await handle.db.select().from(ambiguityLabels)).length;
    const stats = await computeLabels(handle.db);
    expect(stats.labelsAppended).toBe(0);
    const after = (await handle.db.select().from(ambiguityLabels)).length;
    expect(after).toBe(before);
    expect(await verifyAuditChain(handle.db)).toBeNull();
  });
});
