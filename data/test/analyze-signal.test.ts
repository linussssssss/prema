import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  ambiguityLabels,
  createDb,
  linterHits,
  markets,
  rulesVersions,
  venues,
  type DbHandle,
} from "@verdict/schema";
import { analyzeSignal } from "../src/analyze-signal.ts";

// Ten markets, volumes 1..10 so each lands in its own decile.
// `hedge-words` fires on markets 1-5 (version 1).
// Contested: markets 1, 2 (fired) and market 6 (not fired).
//   → P(contested|fired)     = 2/5 = 0.4
//   → P(contested|not fired) = 1/5 = 0.2
//   → lift = 2.0
// `vague-source` fires only on a *version 2* row, so it must not count at all:
// that is the no-hindsight invariant (ADR-0009), and the whole reason this
// analysis joins version_num = 1 rather than using the hit_* columns.
let handle: DbHandle;

beforeAll(async () => {
  handle = await createDb("pglite://memory");
  await handle.migrate();
  const db = handle.db;
  await db.insert(venues).values({ id: "polymarket", name: "Polymarket", kind: "onchain" });

  for (let i = 1; i <= 10; i++) {
    await db.insert(markets).values({
      id: `polymarket:${i}`,
      venueId: "polymarket",
      externalId: String(i),
      question: `q${i}`,
      volumeUsd: String(i * 1000),
      closed: true,
      capturedAt: new Date(),
    });
    const [v1] = await db
      .insert(rulesVersions)
      .values({
        marketId: `polymarket:${i}`,
        versionNum: 1,
        textHash: `h${i}`,
        rulesText: `rules ${i}`,
        source: "gamma_description",
        capturedAt: new Date(),
      })
      .returning({ id: rulesVersions.id });
    if (i <= 5) {
      await db.insert(linterHits).values({
        rulesVersionId: v1!.id,
        ruleId: "hedge-words",
        severity: "warn",
        spanStart: 0,
        spanEnd: 3,
        message: "m",
        linterVersion: "linter-v1.0.0",
        capturedAt: new Date(),
      });
    }
    await db.insert(ambiguityLabels).values({
      marketId: `polymarket:${i}`,
      disputed: i === 1,
      escalated: false,
      resolvedNa: false,
      rulesEditedAfterListing: false,
      contested: i === 1 || i === 2 || i === 6,
      labelVersion: "label-v1",
      computedAt: new Date(),
    });
  }

  // Market 7 gains an edited version whose flag must be invisible here.
  const [v2] = await db
    .insert(rulesVersions)
    .values({
      marketId: "polymarket:7",
      versionNum: 2,
      textHash: "h7b",
      rulesText: "edited",
      source: "gamma_description",
      capturedAt: new Date(),
    })
    .returning({ id: rulesVersions.id });
  await db.insert(linterHits).values({
    rulesVersionId: v2!.id,
    ruleId: "vague-source",
    severity: "warn",
    spanStart: 0,
    spanEnd: 3,
    message: "m",
    linterVersion: "linter-v1.0.0",
    capturedAt: new Date(),
  });
});

afterAll(async () => {
  await handle.close();
});

describe("analyzeSignal", () => {
  it("computes per-rule lift from listing-time flags", async () => {
    const r = (await analyzeSignal(handle.db))!;
    expect(r.labelled).toBe(10);
    expect(r.contested).toBe(3);

    const hedge = r.byRule.find((x) => x.rule === "hedge-words")!;
    expect(hedge.fired).toBe(5);
    expect(hedge.firedContested).toBe(2);
    expect(hedge.notFired).toBe(5);
    expect(hedge.notFiredContested).toBe(1);
    expect(hedge.lift).toBeCloseTo(2.0);
  });

  it("ignores flags on edited versions — the no-hindsight invariant", async () => {
    const r = (await analyzeSignal(handle.db))!;
    // The only vague-source hit lives on market 7's version 2. Counting it
    // would be hindsight: that text did not exist at listing time.
    const vague = r.byRule.find((x) => x.rule === "vague-source")!;
    expect(vague.fired).toBe(0);
  });

  it("buckets markets into deciles by volume", async () => {
    const r = (await analyzeSignal(handle.db))!;
    expect(r.byDecile).toHaveLength(10);
    expect(r.byDecile.every((d) => d.n === 1)).toBe(true);
    // Market 10 has the highest volume, and is not contested.
    expect(r.byDecile.find((d) => d.decile === 10)!.contested).toBe(0);
  });

  it("separates composition from signal (Simpson's paradox)", async () => {
    // A rule with NO within-category effect, made to look strong by composition
    // alone — the exact failure that made status-verb-gap read 20.66x pooled
    // and 1.08x within Politics on 2026-08-24.
    //
    //   Politics: 40 markets, 50% dispute rate, rule fires on all of them
    //   Sports:   40 markets,  0% dispute rate, rule fires on none
    //
    // Within each category the rule is worth exactly nothing. Pooled it looks
    // decisive, because it perfectly tracks which category a market is in.
    const h = await createDb("pglite://memory");
    await h.migrate();
    await h.db.insert(venues).values({ id: "polymarket", name: "Polymarket", kind: "onchain" });
    for (let i = 0; i < 80; i++) {
      const politics = i < 40;
      const id = `polymarket:s${i}`;
      await h.db.insert(markets).values({
        id,
        venueId: "polymarket",
        externalId: `s${i}`,
        question: `q${i}`,
        category: politics ? "Politics" : "Sports",
        volumeUsd: String(1000 + i),
        closed: true,
        capturedAt: new Date(),
      });
      const [v] = await h.db
        .insert(rulesVersions)
        .values({
          marketId: id,
          versionNum: 1,
          textHash: `h${i}`,
          rulesText: "t",
          source: "gamma_description",
          capturedAt: new Date(),
        })
        .returning({ id: rulesVersions.id });
      if (politics) {
        await h.db.insert(linterHits).values({
          rulesVersionId: v!.id,
          ruleId: "hedge-words",
          severity: "warn",
          spanStart: 0,
          spanEnd: 1,
          message: "m",
          linterVersion: "linter-v1.1.0",
          capturedAt: new Date(),
        });
      }
      const disputed = politics && i % 2 === 0;
      await h.db.insert(ambiguityLabels).values({
        marketId: id,
        disputed,
        escalated: false,
        resolvedNa: false,
        rulesEditedAfterListing: false,
        contested: disputed,
        labelVersion: "label-v1",
        computedAt: new Date(),
      });
    }

    const r = (await analyzeSignal(h.db))!;
    const hedge = r.byRuleDisputed.find((x) => x.rule === "hedge-words")!;
    // Pooled: every disputed market fired, none of the non-firing ones did.
    expect(hedge.lift).toBeNull(); // no disputes among not-fired → ratio undefined
    // Stratified: within Politics the rule fires on everything so it has no
    // comparison group, and Sports has no disputes. The estimator must not
    // invent an effect from composition.
    expect(hedge.liftStratified).toBeNull();
    await h.close();
  });

  it("returns null when nothing is labelled", async () => {
    const empty = await createDb("pglite://memory");
    await empty.migrate();
    expect(await analyzeSignal(empty.db)).toBeNull();
    await empty.close();
  });
});
