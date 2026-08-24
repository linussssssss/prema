/**
 * Does the linter predict disputes? (ROADMAP-next-sessions.md §1.3)
 *
 * Written while the backfill runs so the answer arrives minutes after the data
 * rather than costing a session. Three cuts, because one number would mislead:
 *
 *  1. Contested rate by volume decile. Disputes concentrate in high-stakes
 *     markets, so a corpus-wide ~0.1% is true and describes almost nothing
 *     anyone trades. This decides whether a watchlist is sellable.
 *  2. Per-rule lift overall — P(contested | fired) / P(contested | not fired).
 *  3. Per-rule lift inside the top volume decile, where the stakes are.
 *
 * Two invariants this exists to respect:
 *
 *  - **Listing-time flags only** — every rule join is restricted to
 *    `rules_versions.version_num = 1`. The market-level `hit_*` columns are a
 *    latest-text view (ADR-0009/0019) and would leak hindsight on precisely the
 *    rules-edited markets that matter, in the direction that flatters us.
 *  - **Latest label per market** — `ambiguity_labels` is append-only, so a
 *    naive join multiply-counts markets whose label was recomputed.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@verdict/schema";
import { rowsOf } from "./exporters.ts";

export const RULES = [
  "hedge-words",
  "deadline-no-timezone",
  "occurrence-vs-reporting",
  "status-verb-gap",
  "vague-source",
  "outcomes-not-exhaustive",
  "no-na-condition",
] as const;

export interface RuleLift {
  rule: string;
  fired: number;
  firedContested: number;
  notFired: number;
  notFiredContested: number;
  /** Pooled across the whole corpus. Confounded by category — see below. */
  lift: number | null;
  /**
   * Mantel-Haenszel risk ratio stratified by category — the same comparison
   * made *within* each category and then pooled, so composition cannot
   * manufacture it.
   *
   * This exists because the pooled number is misleading by default here.
   * Sports is 1.38M of 2.6M markets and almost never disputes; Politics and
   * Crypto dispute far more. Any rule that fires more on Politics than Sports
   * inherits that gap for free. Measured 2026-08-24: `status-verb-gap` reads
   * 20.66x pooled and **1.08x within Politics**. A large gap between the two
   * columns means the pooled figure is composition, not signal.
   */
  liftStratified: number | null;
  /** Strata contributing to the MH estimate. */
  strata: number;
}

interface StratumRow {
  stratum: string;
  fired: number;
  fired_t: number;
  notfired: number;
  notfired_t: number;
}

/**
 * Mantel-Haenszel pooled risk ratio. Each stratum contributes in proportion to
 * its size, so a huge low-rate stratum cannot drag the estimate the way it does
 * in a naive pooled ratio.
 */
function mantelHaenszel(rows: StratumRow[]): { rr: number | null; strata: number } {
  let num = 0;
  let den = 0;
  let used = 0;
  for (const r of rows) {
    const n1 = r.fired;
    const n0 = r.notfired;
    const N = n1 + n0;
    if (N === 0 || n1 === 0 || n0 === 0) continue;
    num += (r.fired_t * n0) / N;
    den += (r.notfired_t * n1) / N;
    used += 1;
  }
  return { rr: den > 0 ? num / den : null, strata: used };
}

export interface SignalReport {
  markets: number;
  labelled: number;
  contested: number;
  disputed: number;
  byDecile: Array<{ decile: number; n: number; contested: number; disputed: number }>;
  byRule: RuleLift[];
  byRuleTopDecile: RuleLift[];
  /** Same rules, but against `disputed` alone — see the Target note above. */
  byRuleDisputed: RuleLift[];
}

/** One row per market: latest label, listing-time flags, volume decile. */
const BASE = sql`
  with latest_label as (
    select distinct on (market_id) market_id, contested, disputed
    from ambiguity_labels order by market_id, id desc
  ),
  v1 as (
    select market_id, id as rules_version_id
    from rules_versions where version_num = 1
  ),
  base as (
    select m.id,
           m.category,
           ntile(10) over (order by m.volume_usd::double precision nulls first) as decile,
           l.contested,
           l.disputed,
           v1.rules_version_id
    from markets m
    join latest_label l on l.market_id = m.id
    left join v1 on v1.market_id = m.id
  )`;

/**
 * `contested` is currently ~99.7% `resolved_na`, and that label is
 * near-tautologically linked to some rules: `no-na-condition` detects text that
 * never mentions N/A, so the markets it flags mostly *cannot* resolve N/A. Lift
 * against `contested` therefore measures voidability, not dispute risk.
 * `disputed` is the label the thesis is actually about — smaller, but clean.
 */
export type Target = "contested" | "disputed";

async function liftFor(
  db: Db,
  rule: string,
  topDecileOnly: boolean,
  target: Target = "contested",
): Promise<RuleLift> {
  const col = target === "disputed" ? sql`disputed` : sql`contested`;
  // One query per rule returning per-category strata: the pooled figure is the
  // column sums, the stratified one is Mantel-Haenszel over the same rows.
  const strata = rowsOf<StratumRow>(
    await db.execute(sql`
      ${BASE},
      flagged as (
        select b.*, coalesce(b.category, '(none)') as stratum, exists(
          select 1 from linter_hits lh
          where lh.rules_version_id = b.rules_version_id and lh.rule_id = ${rule}
        ) as fired
        from base b
        where b.rules_version_id is not null
          ${topDecileOnly ? sql`and b.decile = 10` : sql``}
      )
      select stratum,
             count(*) filter (where fired)::int as fired,
             count(*) filter (where fired and ${col})::int as fired_t,
             count(*) filter (where not fired)::int as notfired,
             count(*) filter (where not fired and ${col})::int as notfired_t
      from flagged group by stratum`),
  ).map((r) => ({
    stratum: String(r.stratum),
    fired: Number(r.fired),
    fired_t: Number(r.fired_t),
    notfired: Number(r.notfired),
    notfired_t: Number(r.notfired_t),
  }));

  const fired = strata.reduce((a, r) => a + r.fired, 0);
  const firedContested = strata.reduce((a, r) => a + r.fired_t, 0);
  const notFired = strata.reduce((a, r) => a + r.notfired, 0);
  const notFiredContested = strata.reduce((a, r) => a + r.notfired_t, 0);
  const pf = fired ? firedContested / fired : 0;
  const pn = notFired ? notFiredContested / notFired : 0;
  const mh = mantelHaenszel(strata);
  return {
    rule,
    fired,
    firedContested,
    notFired,
    notFiredContested,
    lift: pn > 0 ? pf / pn : null,
    liftStratified: mh.rr,
    strata: mh.strata,
  };
}

/** Returns null when nothing is labelled yet — the backfill has not run. */
export async function analyzeSignal(db: Db): Promise<SignalReport | null> {
  const [totals] = rowsOf<{ markets: number; labelled: number; contested: number; disputed: number }>(
    await db.execute(sql`
      ${BASE}
      select count(*)::int as markets,
             count(contested)::int as labelled,
             count(*) filter (where contested)::int as contested,
             count(*) filter (where disputed)::int as disputed
      from base`),
  );
  if (!totals || totals.labelled === 0) return null;

  const byDecile = rowsOf<{ decile: number; n: number; contested: number; disputed: number }>(
    await db.execute(sql`
      ${BASE}
      select decile, count(*)::int as n,
             count(*) filter (where contested)::int as contested,
             count(*) filter (where disputed)::int as disputed
      from base group by decile order by decile`),
  ).map((r) => ({
    decile: Number(r.decile),
    n: Number(r.n),
    contested: Number(r.contested),
    disputed: Number(r.disputed),
  }));

  const byRule: RuleLift[] = [];
  const byRuleTopDecile: RuleLift[] = [];
  const byRuleDisputed: RuleLift[] = [];
  for (const rule of RULES) {
    byRule.push(await liftFor(db, rule, false));
    byRuleTopDecile.push(await liftFor(db, rule, true));
    byRuleDisputed.push(await liftFor(db, rule, false, "disputed"));
  }
  return { ...totals, byDecile, byRule, byRuleTopDecile, byRuleDisputed };
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(3)}%`);

export function formatReport(r: SignalReport): string {
  const out: string[] = [];
  out.push(
    `markets labelled: ${r.labelled.toLocaleString()}   contested: ${r.contested.toLocaleString()} (${pct(r.contested, r.labelled)})   disputed: ${r.disputed.toLocaleString()}`,
  );
  out.push("\n=== 1. rate by volume decile (10 = highest) ===");
  for (const d of r.byDecile) {
    const bar = "#".repeat(Math.min(40, Math.round((1000 * d.contested) / Math.max(1, d.n))));
    out.push(
      `  d${String(d.decile).padStart(2)}  n=${String(d.n).padStart(8)}  contested=${String(d.contested).padStart(6)} ${pct(d.contested, d.n).padStart(8)}   disputed=${String(d.disputed).padStart(5)} ${pct(d.disputed, d.n).padStart(8)}  ${bar}`,
    );
  }
  const table = (rows: RuleLift[]): void => {
    out.push("  rule                        fired    P(t|fired)    P(t|not)    pooled   by-category   flag");
    for (const x of rows) {
      const pooled = x.lift === null ? "n/a" : x.lift.toFixed(2) + "x";
      const strat = x.liftStratified === null ? "n/a" : x.liftStratified.toFixed(2) + "x";
      // The gap between the two is the point of the table. A pooled figure
      // several times its stratified twin is category composition.
      const suspect =
        x.lift !== null && x.liftStratified !== null && x.liftStratified > 0 && x.lift / x.liftStratified >= 3
          ? "<-- composition"
          : "";
      out.push(
        `  ${x.rule.padEnd(24)} ${String(x.fired).padStart(8)}  ${pct(x.firedContested, x.fired).padStart(10)}  ${pct(x.notFiredContested, x.notFired).padStart(10)}  ${pooled.padStart(8)}  ${strat.padStart(8)} (${x.strata})  ${suspect}`,
      );
    }
  };
  out.push("\n=== 2. per-rule lift, listing-time flags (version 1 only) ===");
  table(r.byRule);
  out.push("\n=== 3. per-rule lift inside the top volume decile ===");
  out.push("  (where the stakes are; a rule useless corpus-wide may still rank here)");
  table(r.byRuleTopDecile);
  out.push("\n=== 4. per-rule lift against `disputed` ALONE ===");
  out.push(
    "  `contested` is ~99.7% resolved_na, which is near-tautologically tied to some\n" +
      "  rules (no-na-condition flags text that never mentions N/A, so those markets\n" +
      "  largely cannot resolve N/A). This cut is the one the thesis is about.",
  );
  table(r.byRuleDisputed);
  out.push(
    "\nReading it:\n" +
      "  · `pooled` is the whole-corpus ratio. `by-category` is Mantel-Haenszel — the\n" +
      "    same comparison made within each category, then pooled by size, so\n" +
      "    composition cannot manufacture it. **Trust the second column.**\n" +
      "  · Sports is 1.38M of 2.6M markets and almost never disputes, so any rule\n" +
      "    firing more on Politics than Sports gets pooled lift for free. On\n" +
      "    2026-08-24 `status-verb-gap` read 20.66x pooled and 1.08x within Politics.\n" +
      "  · Lift near 1.0 means the rule carries no information.\n" +
      "  · Prefer §4 over §2 until `disputed` is fully populated — §2 is ~99.7%\n" +
      "    resolved_na, which measures voidability, not dispute risk.\n" +
      "  · §3 matters more than §2 for a watchlist, which ranks within the markets\n" +
      "    people actually trade.",
  );
  return out.join("\n");
}
