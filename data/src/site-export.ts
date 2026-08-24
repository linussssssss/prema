/**
 * Emits the JSON the website consumes, per `prema-web/docs/DATA_CONTRACT.md`
 * and `CONTENT-HASH.md`.
 *
 * Kept separate from `exporters.ts` on purpose: the CSV/Parquet exports are the
 * research artifact and should stay research-shaped, while this is a projection
 * for one consumer. The site validates everything it receives and **fails its
 * build** on a mismatch, so a wrong shape here is loud rather than silent.
 *
 * Scope today: **`disputes.json` only.** `watchlist.json` and
 * `calibration.json` both require the Phase-1 score, which does not exist —
 * `packages/llm` is a stub and `/eval`'s backtest raises NotImplemented.
 * Emitting them with placeholder numbers would put fabricated accuracy on the
 * page the whole brand rests on, so they are skipped with a logged reason. The
 * site renders an honest "launches with the public dataset" state when a file
 * is absent (`src/lib/data-source.ts`), which is the correct outcome.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { appendAudit, type Db } from "@verdict/schema";
import { rowsOf } from "./exporters.ts";

const ACTOR = "site-export";
export const CONTRACT_VERSION = 1;

export interface SiteExportStats {
  disputeRecords: number;
  skipped: string[];
  files: string[];
}

/* ------------------------------------------------------------------ *
 * RFC 8785 (JCS) canonicalisation
 * ------------------------------------------------------------------ */

/**
 * Minimal JCS: sort object keys by UTF-16 code unit, no insignificant
 * whitespace. Arrays keep their order — the caller must sort them, which is why
 * every array in a record has an explicit sort key in the spec.
 *
 * Numbers never appear in the hashed payload: Postgres numerics are carried as
 * their exact decimal strings. A numeric routed through a float and back is
 * precisely how two machines produce two hashes for one row.
 */
export function canonicalJcs(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JCS: non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJcs).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJcs(v)}`).join(",")}}`;
  }
  throw new Error(`JCS: unsupported type ${typeof value}`);
}

export function contentHashOf(hashedPayload: unknown): { hash: string; bare: string; bytes: string } {
  const bytes = canonicalJcs(hashedPayload);
  const bare = createHash("sha256").update(bytes, "utf8").digest("hex");
  return { hash: `sha256-jcs-1:${bare}`, bare, bytes };
}

/* ------------------------------------------------------------------ *
 * Row shapes
 * ------------------------------------------------------------------ */

interface RecordRow {
  id: string;
  venue_id: string;
  external_id: string;
  slug: string | null;
  question: string;
  category: string | null;
  volume_usd: string | null;
  volume_decile: number | null;
  listed_at: string | null;
  closed_time: string | null;
  end_date: string | null;
  condition_id: string | null;
  question_id: string | null;
  oracle_mechanism: string;
  outcomes: unknown;
  outcome_prices: unknown;
  disputed: boolean;
  escalated: boolean;
  resolved_na: boolean;
  rules_edited: boolean;
  contested: boolean;
  label_version: string;
  computed_at: string;
}

const iso = (v: string | null): string | null => (v === null ? null : new Date(v).toISOString());

/**
 * Contested markets with their listing-time text, flags, timeline and disputes.
 *
 * `version_num = 1` throughout, never the market-level `hit_*` columns: the
 * page claims its flags are what a listing-time score would have surfaced with
 * no hindsight (ADR-0009). The two views diverge exactly on rules-edited
 * markets — which is most of this population — in the direction that flatters
 * us.
 */
async function fetchRecords(db: Db, limit: number): Promise<RecordRow[]> {
  return rowsOf<RecordRow>(
    await db.execute(sql`
      with latest_label as (
        select distinct on (market_id) market_id, disputed, escalated, resolved_na,
               rules_edited_after_listing as rules_edited, contested, label_version, computed_at
        from ambiguity_labels order by market_id, id desc
      ),
      deciled as (
        select id, ntile(10) over (order by volume_usd::double precision nulls first) as volume_decile
        from markets
      )
      select m.id, m.venue_id, m.external_id, m.slug, m.question, m.category,
             m.volume_usd::text as volume_usd, d.volume_decile,
             m.listed_at::text as listed_at, m.closed_time::text as closed_time,
             m.end_date::text as end_date,
             m.condition_id, m.question_id,
             coalesce(nullif(m.resolution_source, ''), 'unknown') as oracle_mechanism,
             m.outcomes, m.outcome_prices,
             l.disputed, l.escalated, l.resolved_na, l.rules_edited, l.contested,
             l.label_version, l.computed_at::text as computed_at
      from markets m
      join latest_label l on l.market_id = m.id
      join deciled d on d.id = m.id
      where l.contested = true
      order by m.volume_usd::double precision desc nulls last
      limit ${limit}`),
  );
}

export async function buildSiteExport(
  db: Db,
  outDir: string,
  opts: { limit?: number } = {},
): Promise<SiteExportStats> {
  const limit = opts.limit ?? 5_000;
  const skipped: string[] = [];
  mkdirSync(outDir, { recursive: true });

  const rows = await fetchRecords(db, limit);
  const records: unknown[] = [];

  for (const r of rows) {

    const versions = rowsOf<{ version_num: number; source: string; text_hash: string; rules_text: string; captured_at: string }>(
      await db.execute(sql`
        select version_num, source, text_hash, rules_text, captured_at::text as captured_at
        from rules_versions where market_id = ${r.id} order by version_num`),
    );
    const v1 = versions.find((v) => Number(v.version_num) === 1);
    // The contract requires version 1 — without it nothing on the page can
    // honestly claim to be hindsight-free, so skip rather than ship a record
    // the site would reject anyway.
    if (!v1) continue;

    const flags = rowsOf<{ rule_id: string; severity: string; span_start: number; span_end: number; message: string; linter_version: string }>(
      await db.execute(sql`
        select lh.rule_id, lh.severity, lh.span_start, lh.span_end, lh.message, lh.linter_version
        from linter_hits lh
        join rules_versions rv on rv.id = lh.rules_version_id
        where rv.market_id = ${r.id} and rv.version_num = 1`),
    )
      // Spans must index into version 1's text: an out-of-range offset renders
      // a nonsense fragment rather than throwing, so drop them here.
      .filter((f) => Number(f.span_end) <= v1.rules_text.length && Number(f.span_start) <= Number(f.span_end))
      .map((f) => ({
        ruleId: f.rule_id,
        severity: f.severity,
        spanStart: Number(f.span_start),
        spanEnd: Number(f.span_end),
        message: f.message,
        linterVersion: f.linter_version,
      }))
      .sort((a, b) => a.spanStart - b.spanStart || a.ruleId.localeCompare(b.ruleId) || a.spanEnd - b.spanEnd);

    const timeline = rowsOf<{ block_time: string | null; chain: string; oracle: string; event_name: string; tx_hash: string }>(
      await db.execute(sql`
        select block_time::text as block_time, chain, oracle, event_name, tx_hash
        from resolution_events
        where question_id = ${r.question_id} or condition_id = ${r.condition_id}`),
    )
      .map((t) => ({
        blockTime: iso(t.block_time),
        chain: t.chain,
        oracle: t.oracle,
        eventName: t.event_name,
        txHash: t.tx_hash,
      }))
      .sort(
        (a, b) =>
          (a.blockTime ?? "￿").localeCompare(b.blockTime ?? "￿") ||
          a.txHash.localeCompare(b.txHash) ||
          a.eventName.localeCompare(b.eventName),
      );

    const disputes = rowsOf<{ proposer: string | null; disputer: string | null; proposed_price: string | null; settled_price: string | null; escalated: boolean }>(
      await db.execute(sql`
        select proposer, disputer, proposed_price::text as proposed_price,
               settled_price::text as settled_price, escalated
        from disputes where market_id = ${r.id}`),
    )
      .map((d) => ({
        proposer: d.proposer,
        disputer: d.disputer,
        proposedPrice: d.proposed_price,
        settledPrice: d.settled_price,
        escalated: d.escalated,
      }))
      .sort(
        (a, b) =>
          (a.proposedPrice ?? "￿").localeCompare(b.proposedPrice ?? "￿") ||
          (a.proposer ?? "￿").localeCompare(b.proposer ?? "￿"),
      );

    const market = {
      id: r.id,
      venueId: r.venue_id,
      externalId: r.external_id,
      slug: r.slug,
      question: r.question,
      category: r.category,
      // Numerics stay decimal strings all the way to the hash.
      volumeUsd: r.volume_usd,
      volumeDecile: r.volume_decile === null ? null : Number(r.volume_decile),
      listedAt: iso(r.listed_at),
      closedTime: iso(r.closed_time),
      endDate: iso(r.end_date),
      conditionId: r.condition_id,
      questionId: r.question_id,
      oracleMechanism: r.oracle_mechanism,
      outcomes: Array.isArray(r.outcomes) ? r.outcomes : null,
      outcomePrices: Array.isArray(r.outcome_prices) ? r.outcome_prices.map(String) : null,
      venueUrl: null as string | null, // derived site-side; never guessed here
    };
    const label = {
      disputed: r.disputed,
      escalated: r.escalated,
      resolvedNa: r.resolved_na,
      rulesEditedAfterListing: r.rules_edited,
      contested: r.contested,
      labelVersion: r.label_version,
      computedAt: iso(r.computed_at),
    };

    // Exactly the field set in CONTENT-HASH.md §3 — `venueUrl`, `rulesText`,
    // `generatedAt` and the hash itself are deliberately absent.
    const hashed = {
      market: { ...market, venueUrl: undefined },
      label,
      listingFlags: flags,
      rulesVersions: versions.map((v) => ({
        version: Number(v.version_num),
        source: v.source,
        textHash: v.text_hash,
        capturedAt: iso(v.captured_at),
      })),
      timeline,
      disputes,
      revealedVotes: null,
    };
    const { hash, bare } = contentHashOf(hashed);

    records.push({
      contractVersion: CONTRACT_VERSION,
      market,
      label,
      listingFlags: flags,
      rulesVersions: versions.map((v) => ({
        version: Number(v.version_num),
        source: v.source,
        textHash: v.text_hash,
        // Full text only for this contested subset, per SEO.md §4 — the bulk
        // research export still carries lengths only.
        rulesText: v.rules_text,
        capturedAt: iso(v.captured_at),
      })),
      timeline,
      disputes,
      revealedVotes: null,
      contentHash: hash,
    });

    // Turns the hash from a checksum into a receipt: every published version of
    // every record lands in the audit chain `verifyAuditChain()` already
    // validates, so a record cannot be revised without rewriting the chain.
    await appendAudit(db, {
      actor: ACTOR,
      action: "publish_dispute_record",
      entity: "dispute_record",
      entityId: r.id,
      payload: { contentHash: bare, contractVersion: CONTRACT_VERSION },
    });
  }

  const files: string[] = [];
  const disputesPath = path.join(outDir, "disputes.json");
  writeFileSync(
    disputesPath,
    JSON.stringify({ contractVersion: CONTRACT_VERSION, generatedAt: new Date().toISOString(), records }, null, 2),
    "utf8",
  );
  files.push(disputesPath);

  // Not written, deliberately. Both need the Phase-1 score; placeholders here
  // would put invented accuracy on the page the brand rests on.
  skipped.push("watchlist.json — needs the Phase-1 score (packages/llm is a stub)");
  skipped.push("watchlist-archive.json — same dependency");
  skipped.push("calibration.json — needs /eval, whose backtest raises NotImplemented");

  return { disputeRecords: records.length, skipped, files };
}
