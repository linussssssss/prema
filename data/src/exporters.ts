import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
// @dsnp/parquetjs has no bundled types for this import style; keep the surface tiny.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import parquet from "@dsnp/parquetjs";
import { asc, eq } from "drizzle-orm";
import {
  ambiguityLabels,
  disputes,
  linterHits,
  markets,
  resolutionEvents,
  rulesVersions,
  type Db,
} from "@verdict/schema";

export interface MarketExportRow {
  market_id: string;
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
  volume_usd: number | null;
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

export async function assembleMarketRows(db: Db): Promise<MarketExportRow[]> {
  const marketRows = await db.select().from(markets).orderBy(asc(markets.id));

  const labelRows = await db.select().from(ambiguityLabels).orderBy(asc(ambiguityLabels.id));
  const latestLabel = new Map<string, (typeof labelRows)[number]>();
  for (const l of labelRows) latestLabel.set(l.marketId, l); // later rows overwrite = latest

  const versionRows = await db
    .select({ id: rulesVersions.id, marketId: rulesVersions.marketId, versionNum: rulesVersions.versionNum, textHash: rulesVersions.textHash })
    .from(rulesVersions)
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

  const hitRows = await db
    .select({ rulesVersionId: linterHits.rulesVersionId, ruleId: linterHits.ruleId })
    .from(linterHits);
  const hitsByMarket = new Map<string, Map<string, number>>();
  for (const h of hitRows) {
    // count hits on the latest version only, so edits don't double-count
    const marketId = versionToMarket.get(h.rulesVersionId);
    if (!marketId) continue;
    if (versionsByMarket.get(marketId)?.latestId !== h.rulesVersionId) continue;
    const m = hitsByMarket.get(marketId) ?? new Map<string, number>();
    m.set(h.ruleId, (m.get(h.ruleId) ?? 0) + 1);
    hitsByMarket.set(marketId, m);
  }

  // Oracle mechanism per market from observed OO events.
  const ooEvents = await db
    .selectDistinct({ questionId: resolutionEvents.questionId, oracle: resolutionEvents.oracle })
    .from(resolutionEvents)
    .where(eq(resolutionEvents.chain, "polygon"));
  const mechanismByQuestion = new Map<string, string>();
  for (const e of ooEvents) {
    if (!e.questionId || (e.oracle !== "oov2" && e.oracle !== "moov2")) continue;
    const prev = mechanismByQuestion.get(e.questionId);
    mechanismByQuestion.set(e.questionId, prev && prev !== e.oracle ? "mixed" : e.oracle);
  }

  const num = (v: string | null): number | null => (v === null ? null : Number(v));
  return marketRows.map((m) => {
    const label = latestLabel.get(m.id);
    const versions = versionsByMarket.get(m.id);
    const hits = hitsByMarket.get(m.id) ?? new Map<string, number>();
    const row: MarketExportRow = {
      market_id: m.id,
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
      volume_usd: num(m.volumeUsd),
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
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(filePath: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    writeFileSync(filePath, "");
    return;
  }
  const headers = Object.keys(rows[0]!);
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

export async function writeMarketsParquet(filePath: string, rows: MarketExportRow[]): Promise<void> {
  const schema = new parquet.ParquetSchema({
    market_id: { type: "UTF8" },
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
    volume_usd: { type: "DOUBLE", optional: true },
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
    hit_hedge_words: { type: "INT32" },
    hit_deadline_no_timezone: { type: "INT32" },
    hit_occurrence_vs_reporting: { type: "INT32" },
    hit_status_verb_gap: { type: "INT32" },
    hit_vague_source: { type: "INT32" },
    hit_outcomes_not_exhaustive: { type: "INT32" },
    hit_no_na_condition: { type: "INT32" },
    hits_total: { type: "INT32" },
  });
  const writer = await parquet.ParquetWriter.openFile(schema, filePath);
  for (const row of rows) await writer.appendRow(row as unknown as Record<string, unknown>);
  await writer.close();
}

export async function exportAll(db: Db, exportsDir: string): Promise<{ files: string[]; markets: MarketExportRow[] }> {
  mkdirSync(exportsDir, { recursive: true });
  const marketRows = await assembleMarketRows(db);
  const files: string[] = [];

  const marketsCsv = path.join(exportsDir, "markets.csv");
  writeCsv(marketsCsv, marketRows as unknown as Record<string, unknown>[]);
  files.push(marketsCsv);

  const marketsParquet = path.join(exportsDir, "markets.parquet");
  await writeMarketsParquet(marketsParquet, marketRows);
  files.push(marketsParquet);

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

  const versionRows = await db.select().from(rulesVersions).orderBy(asc(rulesVersions.id));
  const versionsCsv = path.join(exportsDir, "rules_versions.csv");
  writeCsv(
    versionsCsv,
    versionRows.map((v) => ({
      id: v.id,
      market_id: v.marketId,
      version_num: v.versionNum,
      text_hash: v.textHash,
      source: v.source,
      text_length: v.rulesText.length,
      occurred_at: v.occurredAt?.toISOString() ?? null,
      captured_at: v.capturedAt.toISOString(),
    })),
  );
  files.push(versionsCsv);

  const hitRows = await db.select().from(linterHits).orderBy(asc(linterHits.id));
  const hitsCsv = path.join(exportsDir, "linter_hits.csv");
  writeCsv(
    hitsCsv,
    hitRows.map((h) => ({
      id: h.id,
      rules_version_id: h.rulesVersionId,
      rule_id: h.ruleId,
      severity: h.severity,
      span_start: h.spanStart,
      span_end: h.spanEnd,
      linter_version: h.linterVersion,
      message: h.message,
    })),
  );
  files.push(hitsCsv);

  return { files, markets: marketRows };
}
