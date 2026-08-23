import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { LINTER_VERSION, lintRulesText } from "@verdict/linter";
import { linterHits, markets, rulesClauses, rulesVersions, type Db } from "@verdict/schema";
import { logger } from "../lib/log.ts";

export interface LintRunStats {
  versionsLinted: number;
  versionsSkipped: number;
  hitsStored: number;
}

/** Rules versions pulled per round trip. The corpus is ~2.6M versions whose
 *  text averages ~1 KB, so selecting them in one query exhausts the heap. */
const BATCH = 2_000;

interface PendingClause {
  rulesVersionId: number;
  clauseType: string;
  spanStart: number;
  spanEnd: number;
  text: string;
  extractor: string;
  capturedAt: Date;
}

const clauseKey = (versionId: number, ruleId: string, start: number, end: number): string =>
  `${versionId}:${ruleId}:${start}:${end}`;

/**
 * Lint every rules version not yet linted at this LINTER_VERSION.
 * Zero-hit versions are re-linted on later runs (pure function, cheap);
 * versions with stored hits are skipped, so re-runs never duplicate rows.
 *
 * Streams by keyset over `rules_versions.id` and writes in bulk: at corpus
 * scale the previous select-everything / insert-per-hit shape needed ~5 GB of
 * heap and ~13M round trips.
 */
export async function runLinterOverRules(db: Db): Promise<LintRunStats> {
  const stats: LintRunStats = { versionsLinted: 0, versionsSkipped: 0, hitsStored: 0 };
  let cursor = 0;

  for (;;) {
    const versions = await db
      .select({
        id: rulesVersions.id,
        rulesText: rulesVersions.rulesText,
        outcomes: markets.outcomes,
        resolutionSource: markets.resolutionSource,
      })
      .from(rulesVersions)
      .innerJoin(markets, eq(rulesVersions.marketId, markets.id))
      .where(gt(rulesVersions.id, cursor))
      .orderBy(asc(rulesVersions.id))
      .limit(BATCH);
    if (versions.length === 0) break;
    cursor = versions[versions.length - 1]!.id;

    // Which of *these* versions already have hits at this linter version.
    const ids = versions.map((v) => v.id);
    const alreadyLinted = await db
      .selectDistinct({ rulesVersionId: linterHits.rulesVersionId })
      .from(linterHits)
      .where(and(inArray(linterHits.rulesVersionId, ids), eq(linterHits.linterVersion, LINTER_VERSION)));
    const done = new Set(alreadyLinted.map((r) => r.rulesVersionId));

    const capturedAt = new Date();
    const clauses: PendingClause[] = [];
    const hitRows: Array<{ versionId: number; hit: ReturnType<typeof lintRulesText>[number] }> = [];

    for (const v of versions) {
      if (done.has(v.id)) {
        stats.versionsSkipped++;
        continue;
      }
      const hits = lintRulesText(v.rulesText, {
        outcomes: Array.isArray(v.outcomes) ? (v.outcomes as string[]) : [],
        resolutionSource: v.resolutionSource,
      });
      stats.versionsLinted++;
      for (const hit of hits) {
        hitRows.push({ versionId: v.id, hit });
        if (hit.span.end > hit.span.start) {
          clauses.push({
            rulesVersionId: v.id,
            clauseType: hit.ruleId,
            spanStart: hit.span.start,
            spanEnd: hit.span.end,
            text: v.rulesText.slice(hit.span.start, hit.span.end),
            extractor: LINTER_VERSION,
            capturedAt,
          });
        }
      }
    }

    // Insert clauses first, then map each back to its hit by natural key —
    // matching on the key rather than on returned row order, which Postgres
    // does not contract.
    const clauseIds = new Map<string, number>();
    for (let i = 0; i < clauses.length; i += 500) {
      const inserted = await db
        .insert(rulesClauses)
        .values(clauses.slice(i, i + 500))
        .returning({
          id: rulesClauses.id,
          rulesVersionId: rulesClauses.rulesVersionId,
          clauseType: rulesClauses.clauseType,
          spanStart: rulesClauses.spanStart,
          spanEnd: rulesClauses.spanEnd,
        });
      for (const row of inserted) {
        clauseIds.set(clauseKey(row.rulesVersionId, row.clauseType, row.spanStart, row.spanEnd), row.id);
      }
    }

    const toStore = hitRows.map(({ versionId, hit }) => ({
      rulesVersionId: versionId,
      clauseId: clauseIds.get(clauseKey(versionId, hit.ruleId, hit.span.start, hit.span.end)) ?? null,
      ruleId: hit.ruleId,
      severity: hit.severity,
      spanStart: hit.span.start,
      spanEnd: hit.span.end,
      message: hit.message,
      linterVersion: LINTER_VERSION,
      capturedAt,
    }));
    for (let i = 0; i < toStore.length; i += 500) {
      const inserted = await db
        .insert(linterHits)
        .values(toStore.slice(i, i + 500))
        .onConflictDoNothing({
          target: [
            linterHits.rulesVersionId,
            linterHits.ruleId,
            linterHits.spanStart,
            linterHits.spanEnd,
            linterHits.linterVersion,
          ],
        })
        .returning({ id: linterHits.id });
      stats.hitsStored += inserted.length;
    }

    if ((stats.versionsLinted + stats.versionsSkipped) % 50_000 < BATCH) {
      logger.info({ ...stats, cursor }, "linting progress");
    }
  }

  logger.info(stats, "linter run complete");
  return stats;
}
