/**
 * Dispute post-mortem generator (read-only) — the flagship marketing artifact
 * from MARKETING.md ("render, don't write"). For a contested market it renders
 * a publishable "anatomy of a dispute": the rules text, the linter flags we
 * WOULD have raised at listing time, the composite reason it's contested, and
 * the on-chain propose→dispute→settle→vote timeline.
 *
 * Usage:
 *   pnpm --filter @verdict/data run postmortem --slug <market-slug>
 *   pnpm --filter @verdict/data run postmortem --id polymarket:12345
 *   pnpm --filter @verdict/data run postmortem --top 10        (top contested by volume)
 * Output: data/postmortems/<slug>.md (one file per market) + a stdout summary.
 *
 * NOTE: written against the schema but NOT yet smoke-tested on real data (the
 * first full backfill is still running). Verify output on one real dispute
 * before publishing anything — see TODO "P1 hardening".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { asc, desc, eq, or } from "drizzle-orm";
import {
  ambiguityLabels,
  createDb,
  databaseUrlFromEnv,
  disputes,
  linterHits,
  loadEnv,
  markets,
  resolutionEvents,
  rulesVersions,
  sha256Hex,
  votes,
  type Db,
} from "@verdict/schema";

loadEnv();

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "postmortems");

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    id: { type: "string" },
    top: { type: "string", default: "10" },
  },
});

const fmtDate = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 16).replace("T", " ") + "Z" : "—");
const fmtUsd = (v: string | null): string => (v === null ? "—" : `$${Math.round(Number(v)).toLocaleString("en-US")}`);
const short = (s: string | null | undefined): string => (s ? `${s.slice(0, 10)}…${s.slice(-6)}` : "—");

async function pickMarkets(db: Db): Promise<string[]> {
  if (values.id) return [values.id];
  if (values.slug) {
    const rows = await db.select({ id: markets.id }).from(markets).where(eq(markets.slug, values.slug)).limit(1);
    return rows.map((r) => r.id);
  }
  // Top-N contested by volume. Labels are append-only → keep the latest per market.
  const labelRows = await db
    .select({ marketId: ambiguityLabels.marketId, contested: ambiguityLabels.contested, id: ambiguityLabels.id })
    .from(ambiguityLabels)
    .orderBy(asc(ambiguityLabels.id));
  const latest = new Map<string, boolean>();
  for (const l of labelRows) latest.set(l.marketId, l.contested);
  const contestedIds = [...latest.entries()].filter(([, c]) => c).map(([id]) => id);
  if (contestedIds.length === 0) return [];
  const vols = await db
    .select({ id: markets.id, vol: markets.volumeUsd })
    .from(markets);
  return vols
    .filter((m) => latest.get(m.id) === true)
    .sort((a, b) => Number(b.vol ?? 0) - Number(a.vol ?? 0))
    .slice(0, Number(values.top))
    .map((m) => m.id);
}

async function renderMarket(db: Db, marketId: string): Promise<{ slug: string; md: string } | null> {
  const [m] = await db.select().from(markets).where(eq(markets.id, marketId)).limit(1);
  if (!m) return null;

  const versions = await db
    .select()
    .from(rulesVersions)
    .where(eq(rulesVersions.marketId, marketId))
    .orderBy(asc(rulesVersions.versionNum));
  const v1 = versions[0];
  const latestVersion = versions[versions.length - 1];

  // Linter flags on the LISTING-TIME (v1) rules text — "what we'd have raised".
  const listingHits = v1
    ? await db.select().from(linterHits).where(eq(linterHits.rulesVersionId, v1.id))
    : [];

  const [label] = await db
    .select()
    .from(ambiguityLabels)
    .where(eq(ambiguityLabels.marketId, marketId))
    .orderBy(desc(ambiguityLabels.id))
    .limit(1);

  // On-chain timeline: events joined by questionId or conditionId, chronological.
  const events = await db
    .select()
    .from(resolutionEvents)
    .where(
      or(
        m.questionId ? eq(resolutionEvents.questionId, m.questionId) : undefined,
        m.conditionId ? eq(resolutionEvents.conditionId, m.conditionId) : undefined,
      ),
    )
    .orderBy(asc(resolutionEvents.blockTime), asc(resolutionEvents.logIndex));

  const disputeRows = await db.select().from(disputes).where(eq(disputes.marketId, marketId));
  const voteRows =
    disputeRows.length > 0
      ? await db
          .select()
          .from(votes)
          .where(or(...disputeRows.map((d) => eq(votes.disputeId, d.id))))
      : [];

  const slug = m.slug ?? m.externalId;
  const reasons = label
    ? [
        label.disputed && "disputed on-chain",
        label.escalated && "escalated to a DVM vote",
        label.resolvedNa && "resolved N/A (50-50)",
        label.rulesEditedAfterListing && "rules edited after listing",
      ].filter(Boolean)
    : [];

  const flagTable =
    listingHits.length > 0
      ? [
          "| rule | severity | flagged text |",
          "|---|---|---|",
          ...listingHits.map(
            (h) => `| ${h.ruleId} | ${h.severity} | ${JSON.stringify((v1?.rulesText ?? "").slice(h.spanStart, h.spanEnd))} |`,
          ),
        ].join("\n")
      : "_No listing-time linter flags recorded._";

  const timelineTable =
    events.length > 0
      ? [
          "| time (UTC) | chain | oracle | event | tx |",
          "|---|---|---|---|---|",
          ...events.map(
            (e) =>
              `| ${fmtDate(e.blockTime)} | ${e.chain} | ${e.oracle} | ${e.eventName} | \`${short(e.txHash)}\` |`,
          ),
        ].join("\n")
      : "_No on-chain resolution events joined to this market (open/unresolved, or a join gap)._";

  const disputeDetail =
    disputeRows.length > 0
      ? disputeRows
          .map(
            (d) =>
              `- proposer \`${short(d.proposer)}\` → disputer \`${short(d.disputer)}\`; proposed \`${d.proposedPrice ?? "—"}\`, settled \`${d.settledPrice ?? "—"}\`${d.escalated ? " — **escalated to DVM**" : ""}`,
          )
          .join("\n")
      : "_No dispute record._";

  const voteDetail =
    voteRows.length > 0
      ? `\n### DVM vote (${voteRows.length} revealed vote rows)\n\n` +
        voteRows
          .slice(0, 10)
          .map((v) => `- round ${v.roundId ?? "—"} · voter \`${short(v.voter)}\` · price \`${v.price ?? "—"}\``)
          .join("\n")
      : "";

  const edited = versions.length > 1 ? ` (rules edited ${versions.length - 1}× after listing)` : "";
  const outcome = Array.isArray(m.outcomePrices) ? JSON.stringify(m.outcomePrices) : "—";

  const md = `# Anatomy of a dispute: ${m.question}

| | |
|---|---|
| Market | \`${m.id}\` (${slug}) |
| Category | ${m.category ?? "—"} |
| Volume | ${fmtUsd(m.volumeUsd)} |
| Listed | ${fmtDate(m.listedAt)} |
| Closed | ${fmtDate(m.closedTime ?? m.endDate)} |
| Final prices | ${outcome} |
| Rules versions | ${versions.length}${edited} |
| Condition / question id | \`${short(m.conditionId)}\` / \`${short(m.questionId)}\` |

## Why this market is contested

${reasons.length > 0 ? reasons.map((r) => `- ${r}`).join("\n") : "_Not labeled contested (or labels not yet computed)._"}

## What our linter flagged at listing time

These are the ambiguity flags the deterministic linter raises on the market's
**first** rules text — i.e. what a listing-time risk score would have surfaced
*before* any trading, with no hindsight.

${flagTable}

## On-chain resolution timeline

${timelineTable}

## Dispute detail

${disputeDetail}
${voteDetail}

## Rules text (as resolved)

> ${(latestVersion?.rulesText ?? "—").replace(/\n/g, "\n> ")}

---

_Recommended assessment, not a ruling. Generated by Verdict from on-chain and
venue data. content-hash \`${sha256Hex(m.id + (label?.labelVersion ?? "") + (latestVersion?.textHash ?? "")).slice(0, 16)}\` · ${new Date().toISOString()}_
`;

  return { slug, md };
}

const handle = await createDb(databaseUrlFromEnv());
try {
  const ids = await pickMarkets(handle.db);
  if (ids.length === 0) {
    process.stdout.write("No matching markets (need a --slug/--id, or contested labels for --top).\n");
  } else {
    mkdirSync(outDir, { recursive: true });
    for (const id of ids) {
      const rendered = await renderMarket(handle.db, id);
      if (!rendered) {
        process.stdout.write(`  skip ${id}: not found\n`);
        continue;
      }
      const file = path.join(outDir, `${rendered.slug}.md`);
      writeFileSync(file, rendered.md, "utf8");
      process.stdout.write(`  wrote ${path.relative(process.cwd(), file)}\n`);
    }
  }
} finally {
  await handle.close();
}
