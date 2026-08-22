import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desc, eq } from "drizzle-orm";
import { createDb, markets, rulesVersions, verifyAuditChain, type DbHandle } from "@verdict/schema";
import { parseGammaMarket } from "../src/gamma/client.ts";
import { upsertMarket } from "../src/gamma/ingest.ts";
import { venues } from "@verdict/schema";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "fixtures");
const loadFixture = (name: string): unknown => JSON.parse(readFileSync(path.join(fixturesDir, name), "utf8"));

describe("parseGammaMarket (recorded live responses, 2026-08-22)", () => {
  const list = loadFixture("gamma-markets-limit2.json") as unknown[];

  it("parses the standard binary market", () => {
    const m = parseGammaMarket(list[0])!;
    expect(m.id).toBe("559651");
    expect(m.question).toMatch(/Xi Jinping/);
    expect(m.conditionId).toMatch(/^0xa467b14d/);
    expect(m.questionId).toMatch(/^0x1d925c/);
    expect(m.negRisk).toBe(false);
    expect(m.outcomes).toEqual(["Yes", "No"]);
    expect(m.outcomePrices?.[0]).toBeCloseTo(0.0415);
    expect(m.clobTokenIds).toHaveLength(2);
    expect(m.resolvedBy).toMatch(/^0x157Ce2d6/i);
    expect(m.createdAt?.getUTCFullYear()).toBe(2025);
    expect(m.volumeUsd).toBeGreaterThan(1e6);
    expect(m.description).toMatch(/credible reporting/);
  });

  it("parses the neg-risk market with its request id", () => {
    const m = parseGammaMarket(list[1])!;
    expect(m.negRisk).toBe(true);
    expect(m.negRiskRequestId).toMatch(/^0x3763/);
    expect(m.umaBond).toBe(25000);
  });

  it("parses the keyset envelope market including legacy category field", () => {
    const envelope = loadFixture("gamma-keyset-closed-idasc.json") as { markets: unknown[] };
    const m = parseGammaMarket(envelope.markets[0])!;
    expect(m.id).toBe("12");
    expect(m.category).toBe("US-current-affairs");
    expect(m.closed).toBe(true);
  });

  it("rejects junk", () => {
    expect(parseGammaMarket(null)).toBeNull();
    expect(parseGammaMarket({})).toBeNull();
    expect(parseGammaMarket({ id: "1" })).toBeNull();
  });
});

describe("upsertMarket (PGlite)", () => {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await createDb("pglite://memory");
    await handle.migrate();
    await handle.db.insert(venues).values({ id: "polymarket", name: "Polymarket", kind: "onchain" });
  });
  afterAll(async () =>
    handle.close());

  it("is idempotent and appends rules versions only on text change", async () => {
    const list = loadFixture("gamma-markets-limit2.json") as unknown[];
    const m = parseGammaMarket(list[0])!;
    // createdAt is 2025 → within dataset window
    const first = await upsertMarket(handle.db, m, false);
    expect(first.newRulesVersion).toBe(true);
    const again = await upsertMarket(handle.db, m, false);
    expect(again.newRulesVersion).toBe(false);

    const stored = await handle.db.select().from(markets).where(eq(markets.externalId, "559651"));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.questionId).toBe(m.questionId!.toLowerCase());

    // Simulate a venue-side rules edit → version 2, append-only.
    const edited = { ...m, description: m.description + "\nEdit: clarification added." };
    const third = await upsertMarket(handle.db, edited, false);
    expect(third.newRulesVersion).toBe(true);
    const versions = await handle.db
      .select()
      .from(rulesVersions)
      .where(eq(rulesVersions.marketId, "polymarket:559651"))
      .orderBy(desc(rulesVersions.versionNum));
    expect(versions).toHaveLength(2);
    expect(versions[0]!.versionNum).toBe(2);
    expect(versions[0]!.textHash).not.toBe(versions[1]!.textHash);

    // whitespace-only changes are not edits (normalized hash)
    const cosmetic = { ...edited, description: edited.description + "   \n\n\n" };
    const fourth = await upsertMarket(handle.db, cosmetic, false);
    expect(fourth.newRulesVersion).toBe(false);

    expect(await verifyAuditChain(handle.db)).toBeNull();
  });
});
