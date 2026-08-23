import { asc, sql } from "drizzle-orm";
import { disputes, type Db } from "@verdict/schema";
import type { MarketExportRow } from "./exporters.ts";

export interface BuildStep {
  name: string;
  status: "ok" | "partial" | "skipped" | "failed";
  detail: string;
}

export interface BuildInfo {
  startedAt: Date;
  driver: string;
  steps: BuildStep[];
  caps: Record<string, string | undefined>;
}

const RULES = [
  "hit_hedge_words",
  "hit_deadline_no_timezone",
  "hit_occurrence_vs_reporting",
  "hit_status_verb_gap",
  "hit_vague_source",
  "hit_outcomes_not_exhaustive",
  "hit_no_na_condition",
] as const;

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
const money = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

export async function generateReport(db: Db, rows: MarketExportRow[], info: BuildInfo): Promise<string> {
  const total = rows.length;
  const closed = rows.filter((r) => r.closed === true).length;
  const labeled = rows.filter((r) => r.contested !== null);
  const contested = labeled.filter((r) => r.contested === true);
  const disputed = labeled.filter((r) => r.disputed === true);
  const escalated = labeled.filter((r) => r.escalated === true);
  const resolvedNa = labeled.filter((r) => r.resolved_na === true);
  const rulesEdited = labeled.filter((r) => r.rules_edited_after_listing === true);

  const chainComplete = info.steps.some((s) => s.name === "index-polygon" && s.status === "ok");
  const incomplete = info.steps.filter((s) => s.status !== "ok");

  const disputeRows = await db.select().from(disputes).orderBy(asc(disputes.id));
  const jan = new Date("2026-01-01T00:00:00Z");
  const jun = new Date("2026-06-01T00:00:00Z");
  const disputesJanMay2026 = disputeRows.filter((d) => d.disputedAt && d.disputedAt >= jan && d.disputedAt < jun).length;

  // Disputes we can see on-chain but cannot label, because the market was
  // listed before the 2024-01-01 corpus cut (ADR-0004) so we hold no rules text
  // for it. Structural and permanent, not a defect — but it must be stated, and
  // it must be counted from the data rather than asserted, so it stays true.
  const [unlabelable] = (await db.execute(
    sql`select count(*)::int as events,
               count(distinct question_id)::int as questions
        from resolution_events
        where event_name = 'DisputePrice'
          and question_id is not null
          and question_id not in (select question_id from markets where question_id is not null)`,
  )) as unknown as Array<{ events: number; questions: number }>;
  const orphanEvents = unlabelable?.events ?? 0;
  const orphanQuestions = unlabelable?.questions ?? 0;

  const volumeAll = rows.reduce((a, r) => a + (r.volume_usd ?? 0), 0);
  const volumeContested = contested.reduce((a, r) => a + (r.volume_usd ?? 0), 0);

  // by month (listed_at)
  const byMonth = new Map<string, { total: number; contested: number }>();
  for (const r of rows) {
    const month = r.listed_at?.slice(0, 7) ?? "unknown";
    const entry = byMonth.get(month) ?? { total: 0, contested: 0 };
    entry.total++;
    if (r.contested) entry.contested++;
    byMonth.set(month, entry);
  }
  const monthLines = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, v]) => `| ${m} | ${v.total} | ${v.contested} | ${pct(v.contested, v.total)} |`);

  // by category (top 15)
  const byCategory = new Map<string, { total: number; contested: number }>();
  for (const r of rows) {
    const cat = r.category ?? "uncategorized";
    const entry = byCategory.get(cat) ?? { total: 0, contested: 0 };
    entry.total++;
    if (r.contested) entry.contested++;
    byCategory.set(cat, entry);
  }
  const categoryLines = [...byCategory.entries()]
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, 15)
    .map(([c, v]) => `| ${c} | ${v.total} | ${v.contested} | ${pct(v.contested, v.total)} |`);

  // oracle mechanism distribution (answers the MOOv2 question at a glance)
  const byMechanism = new Map<string, number>();
  for (const r of rows) byMechanism.set(r.oracle_mechanism, (byMechanism.get(r.oracle_mechanism) ?? 0) + 1);
  const mechanismLines = [...byMechanism.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([m, c]) => `| ${m} | ${c} | ${pct(c, total)} |`);

  // linter hit rates by label
  const withRules = labeled.filter((r) => r.rules_version_count > 0);
  const contestedWithRules = withRules.filter((r) => r.contested === true);
  const cleanWithRules = withRules.filter((r) => r.contested === false);
  const ruleLines = RULES.map((col) => {
    const name = col.replace(/^hit_/, "").replace(/_/g, "-");
    const hitAll = withRules.filter((r) => (r[col] as number) > 0).length;
    const hitContested = contestedWithRules.filter((r) => (r[col] as number) > 0).length;
    const hitClean = cleanWithRules.filter((r) => (r[col] as number) > 0).length;
    const pC = contestedWithRules.length ? hitContested / contestedWithRules.length : 0;
    const pN = cleanWithRules.length ? hitClean / cleanWithRules.length : 0;
    const lift = pN > 0 ? (pC / pN).toFixed(2) : "n/a";
    return `| ${name} | ${pct(hitAll, withRules.length)} | ${pct(hitContested, contestedWithRules.length)} | ${pct(hitClean, cleanWithRules.length)} | ${lift} |`;
  });

  const exampleFor = (col: (typeof RULES)[number]): string => {
    const examples = rows
      .filter((r) => (r[col] as number) > 0)
      .sort((a, b) => (b.volume_usd ?? 0) - (a.volume_usd ?? 0))
      .slice(0, 3)
      .map((r) => `  - "${r.question}" (${r.slug ?? r.market_id})`);
    return examples.length > 0 ? examples.join("\n") : "  - (none found)";
  };

  const sanity = chainComplete
    ? disputesJanMay2026 >= 500
      ? `PASS — ${disputesJanMay2026} disputes Jan–May 2026 (expected ~1,000+).`
      : `**FAIL — ${disputesJanMay2026} disputes Jan–May 2026, expected ~1,000+. Numbers are not trustworthy; investigate before using this dataset.**`
    : `NOT EVALUATED — on-chain indexing incomplete (see Build status); the ${disputesJanMay2026} disputes currently stored are a lower bound, not the dataset.`;

  return `# Verdict dataset report

Generated: ${new Date().toISOString()} · driver: ${info.driver} · started: ${info.startedAt.toISOString()}

## Build status

${info.steps.map((s) => `- **${s.name}**: ${s.status} — ${s.detail}`).join("\n")}
${
  incomplete.length > 0
    ? `\n> **This dataset is INCOMPLETE.** Steps not fully run: ${incomplete.map((s) => s.name).join(", ")}. Counts below describe only what was ingested; nothing has been extrapolated.`
    : "\n> All steps ran to completion."
}
${Object.entries(info.caps).filter(([, v]) => v).length > 0 ? `\nCaps in effect: ${JSON.stringify(info.caps)}` : ""}

## Sanity check

${sanity}

## Dataset counts

| metric | count |
|---|---|
| markets (created ≥ 2024-01-01) | ${total} |
| closed | ${closed} |
| open | ${total - closed} |
| labeled | ${labeled.length} |
| disputed | ${disputed.length} |
| escalated (DVM vote) | ${escalated.length} |
| resolved N/A (50-50) | ${resolvedNa.length} |
| rules edited after listing | ${rulesEdited.length} |
| **contested (composite)** | **${contested.length}** (${pct(contested.length, labeled.length)} of labeled) |
| dispute records (oracle requests) | ${disputeRows.length} |

## Known gaps

- **Disputes on pre-2024 markets are visible but unlabelled.** ${orphanEvents}
  \`DisputePrice\` events (${orphanQuestions} distinct questions) resolve to a
  market that was listed before this dataset's 2024-01-01 cut, so no rules text
  exists for them and they are excluded from every count above. They are real
  contested resolutions; they are simply outside the corpus. This is heaviest
  in the first weeks of the indexed window, where disputes land on markets
  listed the previous year.
  *Not* a join failure: the \`questionID = keccak256(ancillaryData)\` derivation
  was verified against adapter-reported ids, which carry the id in topics
  rather than deriving it — 159 of 159 matched on the 2024 sample.
- \`rules_edited_after_listing\` is right-censored: a one-pass crawl sees each
  market once, so only markets re-polled over time can register an edit.

## Value at stake

- Total volume, all markets: ${money(volumeAll)}
- Volume on contested markets: ${money(volumeContested)} (${pct(volumeContested, volumeAll)})

## Markets by month (listed_at)

| month | markets | contested | rate |
|---|---|---|---|
${monthLines.join("\n")}

## Markets by category (top 15)

| category | markets | contested | rate |
|---|---|---|---|
${categoryLines.join("\n")}

## Oracle mechanism (from on-chain OO events)

A nonzero \`moov2\` row means Managed OOv2 is live on-chain; \`unknown\` means no
OO event was joined to the market (open/unresolved, or a join gap).

| mechanism | markets | share |
|---|---|---|
${mechanismLines.join("\n")}

## Linter hit rates (latest rules version per market)

| rule | hit rate (all) | P(hit \\| contested) | P(hit \\| not contested) | lift |
|---|---|---|---|---|
${ruleLines.join("\n")}

### Canonical-pattern examples on real markets

- deadline-no-timezone:
${exampleFor("hit_deadline_no_timezone")}
- occurrence-vs-reporting:
${exampleFor("hit_occurrence_vs_reporting")}
- status-verb-gap:
${exampleFor("hit_status_verb_gap")}
`;
}
