import { eq } from "drizzle-orm";
import { LINTER_VERSION, lintRulesText } from "@verdict/linter";
import { linterHits, markets, rulesClauses, rulesVersions, type Db } from "@verdict/schema";
import { logger } from "../lib/log.ts";

export interface LintRunStats {
  versionsLinted: number;
  versionsSkipped: number;
  hitsStored: number;
}

/**
 * Lint every rules version not yet linted at this LINTER_VERSION.
 * Zero-hit versions are re-linted on later runs (pure function, cheap);
 * versions with stored hits are skipped, so re-runs never duplicate rows.
 */
export async function runLinterOverRules(db: Db): Promise<LintRunStats> {
  const linted = await db
    .selectDistinct({ rulesVersionId: linterHits.rulesVersionId })
    .from(linterHits)
    .where(eq(linterHits.linterVersion, LINTER_VERSION));
  const done = new Set(linted.map((r) => r.rulesVersionId));

  const versions = await db
    .select({
      id: rulesVersions.id,
      rulesText: rulesVersions.rulesText,
      marketId: rulesVersions.marketId,
      outcomes: markets.outcomes,
      resolutionSource: markets.resolutionSource,
    })
    .from(rulesVersions)
    .innerJoin(markets, eq(rulesVersions.marketId, markets.id));

  const stats: LintRunStats = { versionsLinted: 0, versionsSkipped: 0, hitsStored: 0 };
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
      const capturedAt = new Date();
      let clauseId: number | null = null;
      if (hit.span.end > hit.span.start) {
        const clause = await db
          .insert(rulesClauses)
          .values({
            rulesVersionId: v.id,
            clauseType: hit.ruleId,
            spanStart: hit.span.start,
            spanEnd: hit.span.end,
            text: v.rulesText.slice(hit.span.start, hit.span.end),
            extractor: LINTER_VERSION,
            capturedAt,
          })
          .returning({ id: rulesClauses.id });
        clauseId = clause[0]?.id ?? null;
      }
      const inserted = await db
        .insert(linterHits)
        .values({
          rulesVersionId: v.id,
          clauseId,
          ruleId: hit.ruleId,
          severity: hit.severity,
          spanStart: hit.span.start,
          spanEnd: hit.span.end,
          message: hit.message,
          linterVersion: LINTER_VERSION,
          capturedAt,
        })
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
    if (stats.versionsLinted % 1000 === 0) {
      logger.info(stats, "linting progress");
    }
  }
  logger.info(stats, "linter run complete");
  return stats;
}
