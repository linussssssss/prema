import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
// @dsnp/parquetjs has no bundled types for this import style; keep the surface tiny.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import parquet from "@dsnp/parquetjs";
import { asc, gt, inArray, sql } from "drizzle-orm";
import {
  ambiguityLabels,
  disputes,
  linterHits,
  markets,
  resolutionEvents,
  rulesVersions,
  type Db,
} from "@verdict/schema";

/** Markets pulled per round trip. The corpus is ~2.6M markets; holding them
 *  all, plus their assembled export rows, needs several GB of heap. Everything
 *  below is written to work on a bounded window (ADR-0019). */
const BATCH = 20_000;

export interface MarketExportRow {
  market_id: string;
  venue_id: string;
  external_id: string;
  question: string;
  slug: string | null;
  category: string | null;
  neg_risk: boolean;
  condition_id: string | null;
  question_id: string | null;
  oracle_mechanism: string;
  resolution_source: string | null;
  listed_at: string | null;
  end_date: string | null;
  closed: boolean | null;
  closed_time: string | null;
  outcomes: string | null;
  outcome_prices: string | null;
  volume_usd: number | null;
  volume_decile: number | null;
  liquidity_usd: number | null;
  uma_bond: number | null;
  rules_version_count: number;
  latest_rules_hash: string | null;
  disputed: boolean | null;
  escalated: boolean | null;
  resolved_na: boolean | null;
  rules_edited_after_listing: boolean | null;
  contested: boolean | null;
  price_reversal: boolean | null;
  label_version: string | null;
  label_computed_at: string | null;
  hit_hedge_words: number;
  hit_deadline_no_timezone: number;
  hit_occurrence_vs_reporting: number;
  hit_status_verb_gap: number;
  hit_vague_source: number;
  hit_outcomes_not_exhaustive: number;
  hit_no_na_condition: number;
  hits_total: number;
}

const RULE_COLUMNS: Record<string, keyof MarketExportRow> = {
  "hedge-words": "hit_hedge_words",
  "deadline-no-timezone": "hit_deadline_no_timezone",
  "occurrence-vs-reporting": "hit_occurrence_vs_reporting",
  "status-verb-gap": "hit_status_verb_gap",
  "vague-source": "hit_vague_source",
  "outcomes-not-exhaustive": "hit_outcomes_not_exhaustive",
  "no-na-condition": "hit_no_na_condition",
};

/**
 * Volume decile boundaries, computed once so each row can be assigned while
 * streaming. `ntile(10)` would need the whole corpus ranked in one pass; nine
 * percentile cuts describe the same split and survive batching.
 *
 * Disputes concentrate in high-stakes markets, so a rate averaged over 2.6M
 * mostly-trivial markets describes almost nothing anyone trades on. This is the
 * column that makes the stakes-conditioned view possible.
 */
/**
 * `db.execute()` hands back the raw driver result, and the two drivers disagree:
 * postgres.js returns an array of rows, PGlite returns `{ rows: [...] }`. Both
 * are in use (ADR-0003), so normalize rather than assuming.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

async function volumeDecileBounds(db: Db): Promise<number[]> {
  const res = rowsOf<{ bounds: number[] | string | null }>(
    await db.execute(
      sql`select percentile_cont(array[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9])
          within group (order by volume_usd::double precision) as bounds
        from markets where volume_usd is not null`,
    ),
  );
  const raw = res[0]?.bounds ?? null;
  if (raw === null) return [];
  const arr = typeof raw === "string" ? raw.replace(/[{}]/g, "").split(",").map(Number) : raw;
  return arr.filter((n) => Number.isFinite(n));
}

/** 1..10, 10 = highest volume. Null volume stays null: "unknown stakes" and
 *  "lowest stakes" are different claims and must not be conflated. */
function decileFor(volume: number | null, bounds: number[]): number | null {
  if (volume === null || bounds.length === 0) return null;
  for (let i = 0; i < bounds.length; i++) if (volume <= bounds[i]!) return i + 1;
  return 10;
}

/**
 * Stream export rows in bounded batches, calling `onBatch` for each.
 *
 * Every lookup is scoped to the batch's market ids rather than loaded whole:
 * the previous shape selected every market, label, rules version and linter hit
 * into memory at once, which suited the 6k demo slice and needed several GB
 * against the real corpus (ADR-0019).
 */
export async function streamMarketRows(
  db: Db,
  onBatch: (rows: MarketExportRow[]) => Promise<void> | void,
  batchSize = BATCH,
): Promise<void> {
  const bounds = await volumeDecileBounds(db);
  const num = (v: string | null): number | null => (v === null ? null : Number(v));
  let cursor = "";

  for (;;) {
    const marketRows = await db
      .select({
        id: markets.id,
        venueId: markets.venueId,
        externalId: markets.externalId,
        question: markets.question,
        slug: markets.slug,
        category: markets.category,
        negRisk: markets.negRisk,
        conditionId: markets.conditionId,
        questionId: markets.questionId,
        resolutionSource: markets.resolutionSource,
        listedAt: markets.listedAt,
        endDate: markets.endDate,
        closed: markets.closed,
        closedTime: markets.closedTime,
        outcomes: markets.outcomes,
        outcomePrices: markets.outcomePrices,
        volumeUsd: markets.volumeUsd,
        liquidityUsd: markets.liquidityUsd,
        umaBond: markets.umaBond,
      })
      .from(markets)
      .where(gt(markets.id, cursor))
      .orderBy(asc(markets.id))
      .limit(batchSize);
    if (marketRows.length === 0) break;
    cursor = marketRows[marketRows.length - 1]!.id;

    const ids = marketRows.map((m) => m.id);
    const questionIds = marketRows.map((m) => m.questionId).filter((q): q is string => q !== null);

    const labelRows = await db
      .select()
      .from(ambiguityLabels)
      .where(inArray(ambiguityLabels.marketId, ids))
      .orderBy(asc(ambiguityLabels.id));
    const latestLabel = new Map<string, (typeof labelRows)[number]>();
    for (const l of labelRows) latestLabel.set(l.marketId, l); // later rows overwrite = latest

    const versionRows = await db
      .select({
        id: rulesVersions.id,
        marketId: rulesVersions.marketId,
        textHash: rulesVersions.textHash,
      })
      .from(rulesVersions)
      .where(inArray(rulesVersions.marketId, ids))
      .orderBy(asc(rulesVersions.versionNum));
    const versionsByMarket = new Map<string, { count: number; latestHash: string; latestId: number }>();
    const versionToMarket = new Map<number, string>();
    for (const v of versionRows) {
      versionToMarket.set(v.id, v.marketId);
      versionsByMarket.set(v.marketId, {
        count: (versionsByMarket.get(v.marketId)?.count ?? 0) + 1,
        latestHash: v.textHash,
        latestId: v.id,
      });
    }

    const hitsByMarket = new Map<string, Map<string, number>>();
    const versionIds = versionRows.map((v) => v.id);
    if (versionIds.length > 0) {
      const hitRows = await db
        .select({ rulesVersionId: linterHits.rulesVersionId, ruleId: linterHits.ruleId })
        .from(linterHits)
        .where(inArray(linterHits.rulesVersionId, versionIds));
      for (const h of hitRows) {
        // Count hits on the LATEST version only, so an edit doesn't double-count.
        // NOTE: this makes hit_* a *latest-text* view, not a listing-time one.
        // Anything claiming to be hindsight-free (ADR-0009) must instead join
        // linter_hits -> rules_versions WHERE version_num = 1. The two diverge
        // precisely on rules-edited markets, in the flattering direction.
        const marketId = versionToMarket.get(h.rulesVersionId);
        if (!marketId) continue;
        if (versionsByMarket.get(marketId)?.latestId !== h.rulesVersionId) continue;
        const m = hitsByMarket.get(marketId) ?? new Map<string, number>();
        m.set(h.ruleId, (m.get(h.ruleId) ?? 0) + 1);
        hitsByMarket.set(marketId, m);
      }
    }

    const mechanismByQuestion = new Map<string, string>();
    if (questionIds.length > 0) {
      const ooEvents = await db
        .selectDistinct({ questionId: resolutionEvents.questionId, oracle: resolutionEvents.oracle })
        .from(resolutionEvents)
        .where(inArray(resolutionEvents.questionId, questionIds));
      for (const e of ooEvents) {
        if (!e.questionId || (e.oracle !== "oov2" && e.oracle !== "moov2")) continue;
        const prev = mechanismByQuestion.get(e.questionId);
        mechanismByQuestion.set(e.questionId, prev && prev !== e.oracle ? "mixed" : e.oracle);
      }
    }

    const batch = marketRows.map((m) => {
      const label = latestLabel.get(m.id);
      const versions = versionsByMarket.get(m.id);
      const hits = hitsByMarket.get(m.id) ?? new Map<string, number>();
      const volume = num(m.volumeUsd);
      const row: MarketExportRow = {
        market_id: m.id,
        venue_id: m.venueId,
        external_id: m.externalId,
        question: m.question,
        slug: m.slug,
        category: m.category,
        neg_risk: m.negRisk,
        condition_id: m.conditionId,
        question_id: m.questionId,
        oracle_mechanism: (m.questionId && mechanismByQuestion.get(m.questionId)) ?? "unknown",
        resolution_source: m.resolutionSource,
        listed_at: m.listedAt?.toISOString() ?? null,
        end_date: m.endDate?.toISOString() ?? null,
        closed: m.closed,
        closed_time: m.closedTime?.toISOString() ?? null,
        outcomes: m.outcomes === null ? null : JSON.stringify(m.outcomes),
        outcome_prices: m.outcomePrices === null ? null : JSON.stringify(m.outcomePrices),
        volume_usd: volume,
        volume_decile: decileFor(volume, bounds),
        liquidity_usd: num(m.liquidityUsd),
        uma_bond: num(m.umaBond),
        rules_version_count: versions?.count ?? 0,
        latest_rules_hash: versions?.latestHash ?? null,
        disputed: label?.disputed ?? null,
        escalated: label?.escalated ?? null,
        resolved_na: label?.resolvedNa ?? null,
        rules_edited_after_listing: label?.rulesEditedAfterListing ?? null,
        contested: label?.contested ?? null,
        price_reversal: label?.priceReversal ?? null,
        label_version: label?.labelVersion ?? null,
        label_computed_at: label?.computedAt?.toISOString() ?? null,
        hit_hedge_words: 0,
        hit_deadline_no_timezone: 0,
        hit_occurrence_vs_reporting: 0,
        hit_status_verb_gap: 0,
        hit_vague_source: 0,
        hit_outcomes_not_exhaustive: 0,
        hit_no_na_condition: 0,
        hits_total: 0,
      };
      for (const [ruleId, count] of hits) {
        const col = RULE_COLUMNS[ruleId];
        if (col) (row[col] as number) = count;
        row.hits_total += count;
      }
      return row;
    });

    await onBatch(batch);
    if (marketRows.length < batchSize) break;
  }
}

/** Collects every row in memory. Fine for tests and small corpora; the full
 *  pipeline uses `streamMarketRows` instead — 2.6M rows do not fit. */
export async function assembleMarketRows(db: Db): Promise<MarketExportRow[]> {
  const all: MarketExportRow[] = [];
  await streamMarketRows(db, (rows) => {
    all.push(...rows);
  });
  return all;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Append-as-you-go CSV writer. The previous array-based writer built one string
 * per row plus a single joined string for the whole file — around 2 GB of
 * transient allocation on the real corpus, on top of the rows themselves.
 */
export class CsvWriter {
  private readonly fd: number;
  private headers: string[] | null = null;
  private buffer: string[] = [];

  constructor(filePath: string) {
    this.fd = openSync(filePath, "w");
  }

  write(row: Record<string, unknown>): void {
    if (this.headers === null) {
      this.headers = Object.keys(row);
      this.buffer.push(this.headers.join(","));
    }
    this.buffer.push(this.headers.map((h) => csvEscape(row[h])).join(","));
    if (this.buffer.length >= 1_000) this.flush();
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    writeSync(this.fd, this.buffer.join("\n") + "\n");
    this.buffer = [];
  }

  close(): void {
    this.flush();
    closeSync(this.fd);
  }
}

export function writeCsv(filePath: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    writeFileSync(filePath, "");
    return;
  }
  const writer = new CsvWriter(filePath);
  for (const row of rows) writer.write(row);
  writer.close();
}

/**
 * Everything `generateReport` needs, accumulated while streaming so the report
 * never requires the full row set in memory.
 */
export interface ExportSummary {
  total: number;
  closed: number;
  labeled: number;
  contested: number;
  disputed: number;
  escalated: number;
  resolvedNa: number;
  rulesEdited: number;
  volumeAll: number;
  volumeContested: number;
  byMonth: Map<string, { total: number; contested: number }>;
  byCategory: Map<string, { total: number; contested: number }>;
  byMechanism: Map<string, number>;
  /** Dispute concentration by stakes — the cut that makes a ~0.1% corpus rate
   *  interpretable. Keyed 1..10, 10 = highest volume. */
  byDecile: Map<number, { total: number; contested: number }>;
  withRules: number;
  contestedWithRules: number;
  cleanWithRules: number;
  ruleStats: Map<string, { all: number; contested: number; clean: number }>;
  examples: Map<string, Array<{ question: string; slug: string | null; market_id: string; volume: number }>>;
}

function emptySummary(): ExportSummary {
  return {
    total: 0,
    closed: 0,
    labeled: 0,
    contested: 0,
    disputed: 0,
    escalated: 0,
    resolvedNa: 0,
    rulesEdited: 0,
    volumeAll: 0,
    volumeContested: 0,
    byMonth: new Map(),
    byCategory: new Map(),
    byMechanism: new Map(),
    byDecile: new Map(),
    withRules: 0,
    contestedWithRules: 0,
    cleanWithRules: 0,
    ruleStats: new Map(),
    examples: new Map(),
  };
}

function accumulate(summary: ExportSummary, row: MarketExportRow): void {
  summary.total++;
  if (row.closed === true) summary.closed++;
  const volume = row.volume_usd ?? 0;
  summary.volumeAll += volume;

  const bump = (map: Map<string, { total: number; contested: number }>, key: string): void => {
    const e = map.get(key) ?? { total: 0, contested: 0 };
    e.total++;
    if (row.contested === true) e.contested++;
    map.set(key, e);
  };
  bump(summary.byMonth, row.listed_at?.slice(0, 7) ?? "unknown");
  bump(summary.byCategory, row.category ?? "uncategorized");
  summary.byMechanism.set(row.oracle_mechanism, (summary.byMechanism.get(row.oracle_mechanism) ?? 0) + 1);
  if (row.volume_decile !== null) {
    const e = summary.byDecile.get(row.volume_decile) ?? { total: 0, contested: 0 };
    e.total++;
    if (row.contested === true) e.contested++;
    summary.byDecile.set(row.volume_decile, e);
  }

  if (row.contested !== null) {
    summary.labeled++;
    if (row.contested) {
      summary.contested++;
      summary.volumeContested += volume;
    }
    if (row.disputed) summary.disputed++;
    if (row.escalated) summary.escalated++;
    if (row.resolved_na) summary.resolvedNa++;
    if (row.rules_edited_after_listing) summary.rulesEdited++;

    if (row.rules_version_count > 0) {
      summary.withRules++;
      if (row.contested === true) summary.contestedWithRules++;
      if (row.contested === false) summary.cleanWithRules++;
      for (const col of Object.values(RULE_COLUMNS)) {
        if ((row[col] as number) <= 0) continue;
        const s = summary.ruleStats.get(col) ?? { all: 0, contested: 0, clean: 0 };
        s.all++;
        if (row.contested === true) s.contested++;
        if (row.contested === false) s.clean++;
        summary.ruleStats.set(col, s);
      }
    }
  }

  // Top-3 examples per rule by volume, kept as a running top-N so the report
  // can quote real markets without retaining the corpus.
  for (const col of Object.values(RULE_COLUMNS)) {
    if ((row[col] as number) <= 0) continue;
    const list = summary.examples.get(col) ?? [];
    list.push({ question: row.question, slug: row.slug, market_id: row.market_id, volume });
    list.sort((a, b) => b.volume - a.volume);
    if (list.length > 3) list.length = 3;
    summary.examples.set(col, list);
  }
}

function marketsSchema() {
  return new parquet.ParquetSchema({
    market_id: { type: "UTF8" },
    venue_id: { type: "UTF8" },
    external_id: { type: "UTF8" },
    question: { type: "UTF8" },
    slug: { type: "UTF8", optional: true },
    category: { type: "UTF8", optional: true },
    neg_risk: { type: "BOOLEAN" },
    condition_id: { type: "UTF8", optional: true },
    question_id: { type: "UTF8", optional: true },
    oracle_mechanism: { type: "UTF8" },
    resolution_source: { type: "UTF8", optional: true },
    listed_at: { type: "UTF8", optional: true },
    end_date: { type: "UTF8", optional: true },
    closed: { type: "BOOLEAN", optional: true },
    closed_time: { type: "UTF8", optional: true },
    outcomes: { type: "UTF8", optional: true },
    outcome_prices: { type: "UTF8", optional: true },
    volume_usd: { type: "DOUBLE", optional: true },
    volume_decile: { type: "INT32", optional: true },
    liquidity_usd: { type: "DOUBLE", optional: true },
    uma_bond: { type: "DOUBLE", optional: true },
    rules_version_count: { type: "INT32" },
    latest_rules_hash: { type: "UTF8", optional: true },
    disputed: { type: "BOOLEAN", optional: true },
    escalated: { type: "BOOLEAN", optional: true },
    resolved_na: { type: "BOOLEAN", optional: true },
    rules_edited_after_listing: { type: "BOOLEAN", optional: true },
    contested: { type: "BOOLEAN", optional: true },
    price_reversal: { type: "BOOLEAN", optional: true },
    label_version: { type: "UTF8", optional: true },
    label_computed_at: { type: "UTF8", optional: true },
    hit_hedge_words: { type: "INT32" },
    hit_deadline_no_timezone: { type: "INT32" },
    hit_occurrence_vs_reporting: { type: "INT32" },
    hit_status_verb_gap: { type: "INT32" },
    hit_vague_source: { type: "INT32" },
    hit_outcomes_not_exhaustive: { type: "INT32" },
    hit_no_na_condition: { type: "INT32" },
    hits_total: { type: "INT32" },
  });
}

/** Small-corpus convenience (tests). `exportAll` writes Parquet as it streams. */
export async function writeMarketsParquet(filePath: string, rows: MarketExportRow[]): Promise<void> {
  const writer = await parquet.ParquetWriter.openFile(marketsSchema(), filePath);
  for (const row of rows) await writer.appendRow(row as unknown as Record<string, unknown>);
  await writer.close();
}

export async function exportAll(db: Db, exportsDir: string): Promise<{ files: string[]; summary: ExportSummary }> {
  mkdirSync(exportsDir, { recursive: true });
  const files: string[] = [];
  const summary = emptySummary();

  // Markets: CSV, Parquet and the report summary all built in one pass, so the
  // corpus is never held in memory (ADR-0019).
  const marketsCsv = path.join(exportsDir, "markets.csv");
  const marketsParquet = path.join(exportsDir, "markets.parquet");
  const csv = new CsvWriter(marketsCsv);
  const parquetWriter = await parquet.ParquetWriter.openFile(marketsSchema(), marketsParquet);
  await streamMarketRows(db, async (rows) => {
    for (const row of rows) {
      csv.write(row as unknown as Record<string, unknown>);
      await parquetWriter.appendRow(row as unknown as Record<string, unknown>);
      accumulate(summary, row);
    }
  });
  csv.close();
  await parquetWriter.close();
  files.push(marketsCsv, marketsParquet);

  const disputeRows = await db.select().from(disputes).orderBy(asc(disputes.id));
  const disputesCsv = path.join(exportsDir, "disputes.csv");
  writeCsv(
    disputesCsv,
    disputeRows.map((d) => ({
      id: d.id,
      market_id: d.marketId,
      question_id: d.questionId,
      request_key: d.requestKey,
      oracle: d.oracle,
      proposer: d.proposer,
      disputer: d.disputer,
      proposed_price: d.proposedPrice,
      disputed_at: d.disputedAt?.toISOString() ?? null,
      settled_price: d.settledPrice,
      settled_at: d.settledAt?.toISOString() ?? null,
      escalated: d.escalated,
    })),
  );
  files.push(disputesCsv);

  // Rules versions: `text_length` is computed in SQL. Selecting the row would
  // pull ~2.6 GB of rules text across the corpus purely to call `.length`.
  // The text itself is deliberately not exported here — see ADR-0019.
  const versionsCsv = path.join(exportsDir, "rules_versions.csv");
  const versionWriter = new CsvWriter(versionsCsv);
  let versionCursor = 0;
  for (;;) {
    const rows = await db
      .select({
        id: rulesVersions.id,
        marketId: rulesVersions.marketId,
        versionNum: rulesVersions.versionNum,
        textHash: rulesVersions.textHash,
        source: rulesVersions.source,
        textLength: sql<number>`length(${rulesVersions.rulesText})`,
        occurredAt: rulesVersions.occurredAt,
        capturedAt: rulesVersions.capturedAt,
      })
      .from(rulesVersions)
      .where(gt(rulesVersions.id, versionCursor))
      .orderBy(asc(rulesVersions.id))
      .limit(BATCH);
    if (rows.length === 0) break;
    versionCursor = rows[rows.length - 1]!.id;
    for (const v of rows) {
      versionWriter.write({
        id: v.id,
        market_id: v.marketId,
        version_num: v.versionNum,
        text_hash: v.textHash,
        source: v.source,
        text_length: Number(v.textLength),
        occurred_at: v.occurredAt?.toISOString() ?? null,
        captured_at: v.capturedAt.toISOString(),
      });
    }
    if (rows.length < BATCH) break;
  }
  versionWriter.close();
  files.push(versionsCsv);

  const hitsCsv = path.join(exportsDir, "linter_hits.csv");
  const hitWriter = new CsvWriter(hitsCsv);
  let hitCursor = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(linterHits)
      .where(gt(linterHits.id, hitCursor))
      .orderBy(asc(linterHits.id))
      .limit(BATCH);
    if (rows.length === 0) break;
    hitCursor = rows[rows.length - 1]!.id;
    for (const h of rows) {
      hitWriter.write({
        id: h.id,
        rules_version_id: h.rulesVersionId,
        rule_id: h.ruleId,
        severity: h.severity,
        span_start: h.spanStart,
        span_end: h.spanEnd,
        linter_version: h.linterVersion,
        message: h.message,
      });
    }
    if (rows.length < BATCH) break;
  }
  hitWriter.close();
  files.push(hitsCsv);

  return { files, summary };
}
