import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ambiguityLabels,
  createDb,
  linterHits,
  markets,
  rulesVersions,
  venues,
  type DbHandle,
} from "@verdict/schema";
import { assembleMarketRows, exportAll, streamMarketRows } from "../src/exporters.ts";

let handle: DbHandle;
let tmp: string;

beforeAll(async () => {
  handle = await createDb("pglite://memory");
  await handle.migrate();
  tmp = mkdtempSync(path.join(os.tmpdir(), "verdict-export-"));
  const db = handle.db;
  await db.insert(venues).values({ id: "polymarket", name: "Polymarket", kind: "onchain" });
  await db.insert(markets).values([
    {
      id: "polymarket:a",
      venueId: "polymarket",
      externalId: "a",
      question: 'Will "X, Inc." file by June 30?',
      category: "Business",
      listedAt: new Date("2024-02-01T00:00:00Z"),
      closed: true,
      volumeUsd: "12345.67",
      capturedAt: new Date(),
    },
    {
      id: "polymarket:b",
      venueId: "polymarket",
      externalId: "b",
      question: "Clean market?",
      category: "Sports",
      listedAt: new Date("2024-03-01T00:00:00Z"),
      closed: false,
      capturedAt: new Date(),
    },
  ]);
  const inserted = await db
    .insert(rulesVersions)
    .values([
      {
        marketId: "polymarket:a",
        versionNum: 1,
        textHash: "h1",
        rulesText: "Must file by June 30 per court records.",
        source: "gamma_description",
        capturedAt: new Date(),
      },
      {
        marketId: "polymarket:a",
        versionNum: 2,
        textHash: "h2",
        rulesText: "Must file by June 30 per court records. Edited.",
        source: "gamma_description",
        capturedAt: new Date(),
      },
    ])
    .returning({ id: rulesVersions.id, versionNum: rulesVersions.versionNum });
  const v2 = inserted.find((v) => v.versionNum === 2)!;
  const v1 = inserted.find((v) => v.versionNum === 1)!;
  await db.insert(linterHits).values([
    // hit on latest version → counted
    {
      rulesVersionId: v2.id,
      ruleId: "occurrence-vs-reporting",
      severity: "high",
      spanStart: 0,
      spanEnd: 10,
      message: "m",
      linterVersion: "linter-v1.0.0",
      capturedAt: new Date(),
    },
    // hit on the old version → not counted
    {
      rulesVersionId: v1.id,
      ruleId: "hedge-words",
      severity: "warn",
      spanStart: 0,
      spanEnd: 5,
      message: "m",
      linterVersion: "linter-v1.0.0",
      capturedAt: new Date(),
    },
  ]);
  await db.insert(ambiguityLabels).values({
    marketId: "polymarket:a",
    disputed: false,
    escalated: false,
    resolvedNa: false,
    rulesEditedAfterListing: true,
    contested: true,
    labelVersion: "label-v1",
    computedAt: new Date(),
  });
});

afterAll(async () => {
  await handle.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("assembleMarketRows", () => {
  it("joins labels, versions, and latest-version linter hits", async () => {
    const rows = await assembleMarketRows(handle.db);
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.market_id === "polymarket:a")!;
    expect(a.rules_version_count).toBe(2);
    expect(a.latest_rules_hash).toBe("h2");
    expect(a.contested).toBe(true);
    expect(a.rules_edited_after_listing).toBe(true);
    expect(a.hit_occurrence_vs_reporting).toBe(1);
    expect(a.hit_hedge_words).toBe(0); // old-version hit not double-counted
    expect(a.hits_total).toBe(1);
    expect(a.volume_usd).toBeCloseTo(12345.67);
    const b = rows.find((r) => r.market_id === "polymarket:b")!;
    expect(b.contested).toBeNull(); // unlabeled market stays null, not false
  });
});

describe("streamMarketRows", () => {
  it("covers every market exactly once across batches", async () => {
    // The corpus does not fit in memory (ADR-0019), so the export streams. A
    // paging bug would drop or duplicate markets silently, so pin it with a
    // batch size that forces multiple round trips.
    const seen: string[] = [];
    let batches = 0;
    await streamMarketRows(
      handle.db,
      (rows) => {
        batches++;
        for (const r of rows) seen.push(r.market_id);
      },
      1,
    );
    expect(batches).toBeGreaterThan(1);
    expect(seen).toEqual(["polymarket:a", "polymarket:b"]);
    expect(new Set(seen).size).toBe(seen.length); // no duplicates
  });

  it("assigns a volume decile only where volume is known", async () => {
    const rows = await assembleMarketRows(handle.db);
    const a = rows.find((r) => r.market_id === "polymarket:a")!;
    const b = rows.find((r) => r.market_id === "polymarket:b")!;
    expect(a.volume_decile).toBeGreaterThanOrEqual(1);
    expect(a.volume_decile).toBeLessThanOrEqual(10);
    // "unknown stakes" must not be reported as "lowest stakes".
    expect(b.volume_usd).toBeNull();
    expect(b.volume_decile).toBeNull();
    expect(a.venue_id).toBe("polymarket");
    expect(a.label_computed_at).not.toBeNull();
  });
});

describe("exportAll", () => {
  it("writes csv + parquet with proper escaping, and a usable summary", async () => {
    const { files, summary } = await exportAll(handle.db, tmp);
    for (const f of files) expect(existsSync(f)).toBe(true);
    const csv = readFileSync(path.join(tmp, "markets.csv"), "utf8");
    expect(csv.split("\n")[0]).toContain("market_id,venue_id,external_id,question");
    // the question contains a quote and a comma → must be quoted+doubled
    expect(csv).toContain('"Will ""X, Inc."" file by June 30?"');
    expect(existsSync(path.join(tmp, "markets.parquet"))).toBe(true);
    // one row per market, and the trailing newline shouldn't add a phantom row
    expect(csv.trim().split("\n")).toHaveLength(3);

    // The summary replaces the row array the report used to receive.
    expect(summary.total).toBe(2);
    expect(summary.labeled).toBe(1);
    expect(summary.contested).toBe(1);
    expect(summary.rulesEdited).toBe(1);
    expect(summary.byCategory.get("Business")).toEqual({ total: 1, contested: 1 });
    expect(summary.examples.get("hit_occurrence_vs_reporting")?.[0]?.market_id).toBe("polymarket:a");
  });
});
