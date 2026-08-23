/**
 * Post-build validator (read-only). Run after `pnpm dataset:build` to answer
 * the three questions that decide whether the dataset is trustworthy:
 *   1. Dispute sanity gate  — disputes Jan–May 2026 should be ~1,000+.
 *   2. The MOOv2 question   — which resolver adapters exist, and did any
 *      market actually resolve through Managed OOv2 vs plain OOv2?
 *   3. questionId join rate — fraction of on-chain disputes that matched a
 *      market (should be ~100% for post-2024 markets).
 * Plus integrity checks (audit chain, orphaned disputes, label coverage).
 *
 * Usage: pnpm --filter @verdict/data run validate
 * Exits non-zero if the sanity gate fails, so it can gate CI/automation.
 */
import { sql } from "drizzle-orm";
import { createDb, databaseUrlFromEnv, loadEnv, verifyAuditChain, type Db } from "@verdict/schema";

loadEnv();

/** Normalize db.execute() across postgres-js (returns array) and pglite (returns {rows}). */
async function rows<T = Record<string, unknown>>(db: Db, query: Parameters<Db["execute"]>[0]): Promise<T[]> {
  const res = (await db.execute(query)) as unknown;
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === "object" && "rows" in res) return (res as { rows: T[] }).rows;
  return [];
}

const n = (v: unknown): number => Number(v ?? 0);

const handle = await createDb(databaseUrlFromEnv());
const db = handle.db;
let sanityFailed = false;

try {
  const line = (s: string) => process.stdout.write(s + "\n");
  line(`# Verdict dataset validation — ${new Date().toISOString()} (driver: ${handle.driver})\n`);

  // --- Headline counts -----------------------------------------------------
  const [counts] = await rows(
    db,
    sql`select
      (select count(*) from markets) as markets,
      (select count(*) from markets where closed = true) as closed,
      (select count(*) from rules_versions) as rules_versions,
      (select count(*) from resolution_events) as resolution_events,
      (select count(*) from disputes) as disputes,
      (select count(*) from votes) as votes,
      (select count(distinct market_id) from ambiguity_labels) as labeled`,
  );
  line("## Counts");
  line(JSON.stringify(counts));

  // --- 1. Dispute sanity gate (by month) -----------------------------------
  line("\n## 1. Dispute sanity gate (disputes by month, disputed_at)");
  const byMonth = await rows(
    db,
    sql`select to_char(date_trunc('month', disputed_at), 'YYYY-MM') as month, count(*) as n
        from disputes where disputed_at is not null
        group by 1 order by 1`,
  );
  for (const r of byMonth) line(`  ${r.month}: ${n(r.n)}`);
  const janMay2026 = byMonth
    .filter((r) => typeof r.month === "string" && r.month >= "2026-01" && r.month <= "2026-05")
    .reduce((a, r) => a + n(r.n), 0);
  const gate = janMay2026 >= 1000 ? "PASS" : janMay2026 >= 500 ? "SOFT-PASS" : "FAIL";
  if (gate === "FAIL") sanityFailed = true;
  line(`  → Jan–May 2026 total: ${janMay2026} (expected ~1,000+) → ${gate}`);

  // --- 2. The MOOv2 question -----------------------------------------------
  line("\n## 2. MOOv2 question");
  line("resolver adapter (markets.resolved_by) distribution — any address beyond the 4 known adapters is unenumerated:");
  const byResolver = await rows(
    db,
    sql`select coalesce(resolved_by, '(null)') as resolver, count(*) as n
        from markets group by 1 order by 2 desc limit 20`,
  );
  for (const r of byResolver) line(`  ${r.resolver}: ${n(r.n)}`);
  line("OO events by mechanism (resolution_events.oracle) — nonzero moov2 means Managed OOv2 is live on-chain:");
  const byOracle = await rows(
    db,
    sql`select oracle, count(*) as n from resolution_events group by 1 order by 2 desc`,
  );
  for (const r of byOracle) line(`  ${r.oracle}: ${n(r.n)}`);
  const moov2 = byOracle.filter((r) => r.oracle === "moov2").reduce((a, r) => a + n(r.n), 0);
  line(`  → moov2 events: ${moov2} ${moov2 > 0 ? "(Managed OOv2 IS live — verify address in config.ts)" : "(no Managed OOv2 events observed — matches the 2026-08-22 finding)"}`);

  // --- 3. questionId join rate ---------------------------------------------
  line("\n## 3. questionId join rate (on-chain → markets)");
  const [disputeJoin] = await rows(
    db,
    sql`select
      count(*) as total,
      count(*) filter (where m.id is not null) as matched
    from resolution_events re
    left join markets m on m.question_id = re.question_id
    where re.event_name = 'DisputePrice'`,
  );
  const dTotal = n(disputeJoin?.total);
  const dMatched = n(disputeJoin?.matched);
  line(`  DisputePrice events: ${dMatched}/${dTotal} matched a market (${dTotal ? ((100 * dMatched) / dTotal).toFixed(1) : "n/a"}%)`);
  const [initJoin] = await rows(
    db,
    sql`select
      count(*) as total,
      count(*) filter (where m.id is not null) as matched
    from resolution_events re
    left join markets m on m.question_id = re.question_id
    where re.event_name = 'QuestionInitialized'`,
  );
  const iTotal = n(initJoin?.total);
  const iMatched = n(initJoin?.matched);
  line(`  QuestionInitialized events: ${iMatched}/${iTotal} matched a market (${iTotal ? ((100 * iMatched) / iTotal).toFixed(1) : "n/a"}%)`);
  line("  (Low rates point at the keccak256(ancillary) derivation or an address/ABI gap — see TODO P0.)");

  // --- Integrity checks ----------------------------------------------------
  line("\n## Integrity");
  const brokenAt = await verifyAuditChain(db);
  line(`  audit hash chain: ${brokenAt === null ? "INTACT" : `BROKEN at row ${brokenAt}`}`);
  if (brokenAt !== null) sanityFailed = true;
  const [orphans] = await rows(
    db,
    sql`select
      (select count(*) from disputes where market_id is null) as unjoined_disputes,
      (select count(*) from ambiguity_labels where contested = true) as contested_labels,
      (select count(*) from linter_hits) as linter_hits`,
  );
  line(`  disputes with no market match: ${n(orphans?.unjoined_disputes)}`);
  line(`  contested labels: ${n(orphans?.contested_labels)}`);
  line(`  linter hits: ${n(orphans?.linter_hits)}`);

  line(`\n${sanityFailed ? "RESULT: FAIL — do not trust this dataset until resolved." : "RESULT: OK"}`);
} finally {
  await handle.close();
}

if (sanityFailed) process.exitCode = 1;
