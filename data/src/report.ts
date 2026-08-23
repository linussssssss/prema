import { asc, sql } from "drizzle-orm";
import { disputes, type Db } from "@verdict/schema";
import { rowsOf, type ExportSummary } from "./exporters.ts";

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

export async function generateReport(db: Db, summary: ExportSummary, info: BuildInfo): Promise<string> {
  // Takes the streamed summary rather than the row set: the corpus does not fit
  // in memory, and every figure below is an accumulation anyway (ADR-0019).
  const total = summary.total;
  const closed = summary.closed;
  const labeledCount = summary.labeled;
  const contestedCount = summary.contested;

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
  const [unlabelable] = rowsOf<{ events: number; questions: number }>(
    await db.execute(
      sql`select count(*)::int as events,
               count(distinct question_id)::int as questions
        from resolution_events
        where event_name = 'DisputePrice'
          and question_id is not null
          and question_id not in (select question_id from markets where question_id is not null)`,
    ),
  );
  const orphanEvents = unlabelable?.events ?? 0;
  const orphanQuestions = unlabelable?.questions ?? 0;

  const volumeAll = summary.volumeAll;
  const volumeContested = summary.volumeContested;

  const monthLines = [...summary.byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, v]) => `| ${m} | ${v.total} | ${v.contested} | ${pct(v.contested, v.total)} |`);

  const categoryLines = [...summary.byCategory.entries()]
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, 15)
    .map(([c, v]) => `| ${c} | ${v.total} | ${v.contested} | ${pct(v.contested, v.total)} |`);

  const mechanismLines = [...summary.byMechanism.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([m, c]) => `| ${m} | ${c} | ${pct(c, total)} |`);

  // Contested rate by volume decile. A rate averaged over a corpus that is
  // mostly trivial markets is true and close to useless; disputes concentrate
  // in high-stakes markets, so this cut is what makes the number interpretable.
  const decileLines = [...summary.byDecile.entries()]
    .sort(([a], [b]) => a - b)
    .map(([d, v]) => `| ${d}${d === 10 ? " (highest)" : d === 1 ? " (lowest)" : ""} | ${v.total} | ${v.contested} | ${pct(v.contested, v.total)} |`);

  const withRules = summary.withRules;
  const contestedWithRules = summary.contestedWithRules;
  const cleanWithRules = summary.cleanWithRules;
  const ruleLines = RULES.map((col) => {
    const name = col.replace(/^hit_/, "").replace(/_/g, "-");
    const s = summary.ruleStats.get(col) ?? { all: 0, contested: 0, clean: 0 };
    const pC = contestedWithRules ? s.contested / contestedWithRules : 0;
    const pN = cleanWithRules ? s.clean / cleanWithRules : 0;
    const lift = pN > 0 ? (pC / pN).toFixed(2) : "n/a";
    return `| ${name} | ${pct(s.all, withRules)} | ${pct(s.contested, contestedWithRules)} | ${pct(s.clean, cleanWithRules)} | ${lift} |`;
  });

  const exampleFor = (col: (typeof RULES)[number]): string => {
    const examples = (summary.examples.get(col) ?? []).map(
      (e) => `  - "${e.question}" (${e.slug ?? e.market_id})`,
    );
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
| labeled | ${labeledCount} |
| disputed | ${summary.disputed} |
| escalated (DVM vote) | ${summary.escalated} |
| resolved N/A (50-50) | ${summary.resolvedNa} |
| rules edited after listing | ${summary.rulesEdited} |
| **contested (composite)** | **${contestedCount}** (${pct(contestedCount, labeledCount)} of labeled) |
| dispute records (oracle requests) | ${disputeRows.length} |

## Contested rate by volume decile

Disputes concentrate in high-stakes markets, so the corpus-wide rate above
averages over a population most of which nobody trades. Decile 10 is the
highest-volume tenth; markets with no volume figure are excluded.

| decile | markets | contested | rate |
|---|---|---|---|
${decileLines.length > 0 ? decileLines.join("\n") : "| (no volume data) | | | |"}

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
