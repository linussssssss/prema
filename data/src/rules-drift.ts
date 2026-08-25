/**
 * Did a market's rules change after it was listed? (ADR-0025)
 *
 * The Gamma corpus cannot answer this: every market has exactly one Gamma
 * rules version, because the ingest captured each market once. So
 * `rules_edited_after_listing` has been structurally 0 — a data limitation
 * that reads like a finding.
 *
 * The chain gives us a second, independent snapshot. Every `QuestionInitialized`
 * event (2,166,514 of them, 100% populated, ~1,489 chars each) carries the
 * ancillary data the adapter committed at listing time. It is immutable and
 * timestamped. Comparing it against Gamma's current text detects post-listing
 * edits **retroactively across the whole corpus**, with no waiting.
 *
 * This matters beyond the label: a market resolving against rules that were
 * changed after people traded on them is the shape of the 2026 Polymarket
 * litigation, and a hash-chained contemporaneous record of both versions is
 * the artifact that settles it.
 *
 * What this does NOT do: verify that a resolution was *correct*. That needs
 * external ground truth per market. This measures only whether the rules moved.
 */
import { sql } from "drizzle-orm";
import { normalizeRulesText, type Db } from "@verdict/schema";
import { rowsOf } from "./exporters.ts";

/** Rows per keyset page. The join spans 2.1M events — see ADR-0019. */
const BATCH = 20_000;

/**
 * Pull the `description` out of Polymarket's ancillary envelope.
 *
 * Verified against live data rather than written from memory (CLAUDE.md), the
 * envelope is:
 *
 *   q: title: <title>, description: <description> market_id: <id>
 *   res_data: p1: 0, p2: 1, p3: 0.5. Where p1 corresponds to ...
 *   ... should be considered.,initializer:<address>
 *
 * Gamma's `rules_text` is exactly the `<description>` span, so everything
 * before it and the trailing metadata block must come off before comparing.
 * Returns null when the envelope is not recognised, so unparsed rows are
 * reported as their own bucket instead of being silently counted as drift.
 */
export function extractAncillaryDescription(ancillary: string): string | null {
  const start = ancillary.indexOf("description:");
  if (start === -1) return null;
  const body = ancillary.slice(start + "description:".length);

  // Trailing metadata. `market_id:` precedes `res_data:` when both are present;
  // take the earliest marker that actually appears.
  const enders = [" market_id:", "market_id:", " res_data:", "res_data:", ",initializer:"];
  let cut = body.length;
  for (const marker of enders) {
    const i = body.indexOf(marker);
    if (i !== -1 && i < cut) cut = i;
  }
  const description = body.slice(0, cut).trim();
  return description === "" ? null : description;
}

export type DriftVerdict = "identical" | "drifted" | "unparsed" | "no_gamma_text";

export interface DriftStats {
  compared: number;
  identical: number;
  drifted: number;
  unparsed: number;
  noGammaText: number;
  /** Drifted rows bucketed by how much the text moved. */
  byMagnitude: Record<string, number>;
  /** Drifted rows by market category, to catch composition (ADR-0020). */
  byCategory: Record<string, { drifted: number; compared: number }>;
  examples: Array<{ marketId: string; category: string | null; onchainLen: number; gammaLen: number }>;
}

export function classify(onchain: string | null, gamma: string | null): DriftVerdict {
  if (onchain === null) return "unparsed";
  if (gamma === null || gamma.trim() === "") return "no_gamma_text";
  return normalizeRulesText(onchain) === normalizeRulesText(gamma) ? "identical" : "drifted";
}

/** Bucket by relative length change — a cheap proxy for "how big was the edit". */
function magnitudeOf(onchain: string, gamma: string): string {
  const a = normalizeRulesText(onchain);
  const b = normalizeRulesText(gamma);
  if (a.length === b.length) return "same length, different text";
  const ratio = Math.abs(a.length - b.length) / Math.max(a.length, b.length);
  if (ratio < 0.02) return "<2% length change";
  if (ratio < 0.1) return "2-10% length change";
  if (ratio < 0.5) return "10-50% length change";
  return ">50% length change";
}

interface Row {
  marketId: string;
  category: string | null;
  ancillary: string;
  gamma: string | null;
}

export async function analyzeRulesDrift(db: Db, limit?: number): Promise<DriftStats> {
  const stats: DriftStats = {
    compared: 0,
    identical: 0,
    drifted: 0,
    unparsed: 0,
    noGammaText: 0,
    byMagnitude: {},
    byCategory: {},
    examples: [],
  };

  let cursor = "";
  for (;;) {
    // Keyset by market id. The market join takes neg-risk into account
    // (ADR-0024) or it silently drops 505k markets.
    const rows = rowsOf<Row>(
      await db.execute(sql`
        select m.id            as "marketId",
               m.category      as "category",
               (q.args->>'ancillaryDataUtf8') as "ancillary",
               rv.rules_text   as "gamma"
          from resolution_events q
          join markets m
            on m.question_id = q.question_id
            or m.neg_risk_request_id = q.question_id
          join rules_versions rv
            on rv.market_id = m.id and rv.version_num = 1
         where q.event_name = 'QuestionInitialized'
           and q.args->>'ancillaryDataUtf8' is not null
           and m.id > ${cursor}
         order by m.id
         limit ${BATCH}`),
    );
    if (rows.length === 0) break;
    cursor = String(rows[rows.length - 1]!.marketId);

    for (const r of rows) {
      const onchain = extractAncillaryDescription(String(r.ancillary));
      const verdict = classify(onchain, r.gamma);
      stats.compared += 1;
      const cat = r.category ?? "(none)";
      stats.byCategory[cat] ??= { drifted: 0, compared: 0 };
      stats.byCategory[cat].compared += 1;

      if (verdict === "unparsed") stats.unparsed += 1;
      else if (verdict === "no_gamma_text") stats.noGammaText += 1;
      else if (verdict === "identical") stats.identical += 1;
      else {
        stats.drifted += 1;
        stats.byCategory[cat].drifted += 1;
        const mag = magnitudeOf(onchain!, r.gamma!);
        stats.byMagnitude[mag] = (stats.byMagnitude[mag] ?? 0) + 1;
        if (stats.examples.length < 10) {
          stats.examples.push({
            marketId: String(r.marketId),
            category: r.category,
            onchainLen: normalizeRulesText(onchain!).length,
            gammaLen: normalizeRulesText(r.gamma!).length,
          });
        }
      }
    }

    if (limit && stats.compared >= limit) break;
    if (rows.length < BATCH) break;
  }

  return stats;
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(3)}%`);

export function formatDrift(s: DriftStats): string {
  const out: string[] = [];
  out.push(`compared: ${s.compared.toLocaleString()} markets (on-chain listing text vs Gamma current text)`);
  out.push(`  identical      ${String(s.identical).padStart(9)}  ${pct(s.identical, s.compared)}`);
  out.push(`  DRIFTED        ${String(s.drifted).padStart(9)}  ${pct(s.drifted, s.compared)}`);
  out.push(`  unparsed       ${String(s.unparsed).padStart(9)}  ${pct(s.unparsed, s.compared)}  (envelope not recognised)`);
  out.push(`  no gamma text  ${String(s.noGammaText).padStart(9)}  ${pct(s.noGammaText, s.compared)}`);

  if (s.drifted > 0) {
    out.push("\nDrift magnitude:");
    for (const [k, v] of Object.entries(s.byMagnitude).sort((a, b) => b[1] - a[1])) {
      out.push(`  ${k.padEnd(30)} ${String(v).padStart(8)}  ${pct(v, s.drifted)} of drifted`);
    }
    out.push("\nBy category (drift rate; watch for composition — ADR-0020):");
    const cats = Object.entries(s.byCategory)
      .filter(([, v]) => v.compared >= 1000)
      .sort((a, b) => b[1].drifted / b[1].compared - a[1].drifted / a[1].compared)
      .slice(0, 12);
    for (const [k, v] of cats) {
      out.push(`  ${k.padEnd(22)} ${String(v.drifted).padStart(8)} / ${String(v.compared).padStart(9)}  ${pct(v.drifted, v.compared)}`);
    }
  }
  out.push(
    "\nNote: this measures whether the rules TEXT moved between listing and now.\n" +
      "It does not verify that any resolution was correct — that needs external\n" +
      "ground truth per market and is deliberately out of scope.",
  );
  return out.join("\n");
}
