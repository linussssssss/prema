import { and, desc, eq, sql } from "drizzle-orm";
import {
  appendAudit,
  ingestState,
  markets,
  rulesTextHash,
  rulesVersions,
  venues,
  type Db,
} from "@verdict/schema";
import { DATASET_START, VENUE_POLYMARKET } from "../config.ts";
import { logger } from "../lib/log.ts";
import { fetchMarketsPage, type GammaMarket } from "./client.ts";

const ACTOR = "ingest-polymarket";

export interface IngestOptions {
  /** Cap on pages per pass — for demo/CI runs. Undefined = full crawl. */
  maxPages?: number | undefined;
  pageLimit?: number;
  /** Store the full Gamma object per market (jsonb). Costs space, aids reproducibility. */
  storeRaw?: boolean;
  /**
   * Crawl newest-first (id descending) and stop a pass once a whole page is
   * pre-2024. Meant for capped demo runs: id-ascending would spend its page
   * budget on 2020-2023 markets that the createdAt cut then discards.
   */
  newestFirst?: boolean;
}

export interface IngestStats {
  pagesFetched: number;
  seen: number;
  upserted: number;
  skippedPre2024: number;
  newRulesVersions: number;
  invalid: number;
}

/**
 * Crawl Gamma /markets/keyset in two passes (closed=true, then default/open),
 * client-filtering on createdAt >= DATASET_START (no server-side created-at
 * filter exists; start_date_min is unreliable on old rows — see fixtures).
 * Idempotent; resumes from a stored cursor per pass.
 */
export async function ingestPolymarketMarkets(db: Db, opts: IngestOptions = {}): Promise<IngestStats> {
  await db
    .insert(venues)
    .values({ id: VENUE_POLYMARKET, name: "Polymarket", kind: "onchain" })
    .onConflictDoNothing();

  const stats: IngestStats = { pagesFetched: 0, seen: 0, upserted: 0, skippedPre2024: 0, newRulesVersions: 0, invalid: 0 };
  for (const pass of ["closed", "open"] as const) {
    await ingestPass(db, pass, opts, stats);
  }
  return stats;
}

async function ingestPass(db: Db, pass: "closed" | "open", opts: IngestOptions, stats: IngestStats): Promise<void> {
  const stateKey = `gamma:markets:${pass}${opts.newestFirst ? ":desc" : ""}:cursor`;
  const stored = await db.select().from(ingestState).where(eq(ingestState.key, stateKey));
  const storedValue = stored[0]?.value as { cursor?: string; done?: boolean } | undefined;
  let cursor: string | undefined = storedValue?.done ? undefined : storedValue?.cursor;
  if (storedValue?.done) {
    // Completed pass: re-crawl from the start to pick up edits on open markets;
    // for the closed pass this is also the "incremental" path (idempotent upserts).
    cursor = undefined;
  }

  let pages = 0;
  for (;;) {
    if (opts.maxPages !== undefined && pages >= opts.maxPages) break;
    const page = await fetchMarketsPage({
      afterCursor: cursor,
      limit: opts.pageLimit ?? 100,
      closed: pass === "closed" ? true : undefined,
      ascending: !opts.newestFirst,
    });
    pages++;
    stats.pagesFetched++;
    stats.invalid += page.invalidCount;

    const allPre2024 =
      page.markets.length > 0 && page.markets.every((m) => !m.createdAt || m.createdAt < DATASET_START);

    for (const market of page.markets) {
      stats.seen++;
      if (!market.createdAt || market.createdAt < DATASET_START) {
        stats.skippedPre2024++;
        continue;
      }
      const changed = await upsertMarket(db, market, opts.storeRaw ?? false);
      stats.upserted++;
      if (changed.newRulesVersion) stats.newRulesVersions++;
    }

    await appendAudit(db, {
      actor: ACTOR,
      action: "ingest.gamma.page",
      entity: "gamma_page",
      entityId: `${pass}:${pages}`,
      payload: { pass, cursor: cursor ?? null, count: page.markets.length },
    });
    await setState(db, stateKey, { cursor: page.nextCursor ?? cursor ?? null, done: page.nextCursor === undefined });

    logger.info({ pass, pages, seen: stats.seen, upserted: stats.upserted }, "gamma page ingested");
    if (opts.newestFirst && allPre2024) break; // descending crawl left the dataset window
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
}

async function setState(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(ingestState)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: ingestState.key, set: { value, updatedAt: new Date() } });
}

const numStr = (v: number | null): string | null => (v === null ? null : String(v));

export async function upsertMarket(
  db: Db,
  m: GammaMarket,
  storeRaw: boolean,
): Promise<{ newRulesVersion: boolean }> {
  const id = `${VENUE_POLYMARKET}:${m.id}`;
  const capturedAt = new Date();
  const row = {
    id,
    venueId: VENUE_POLYMARKET,
    externalId: m.id,
    slug: m.slug,
    question: m.question,
    category: m.category,
    tags: m.tags,
    conditionId: m.conditionId?.toLowerCase() ?? null,
    questionId: m.questionId?.toLowerCase() ?? null,
    negRisk: m.negRisk,
    negRiskRequestId: m.negRiskRequestId?.toLowerCase() ?? null,
    resolvedBy: m.resolvedBy?.toLowerCase() ?? null,
    resolutionSource: m.resolutionSource,
    outcomes: m.outcomes,
    outcomePrices: m.outcomePrices,
    clobTokenIds: m.clobTokenIds,
    endDate: m.endDate,
    listedAt: m.createdAt,
    startDate: m.startDate,
    closedTime: m.closedTime,
    active: m.active,
    closed: m.closed,
    volumeUsd: numStr(m.volumeUsd),
    liquidityUsd: numStr(m.liquidityUsd),
    volume24h: numStr(m.volume24h),
    umaBond: numStr(m.umaBond),
    umaReward: numStr(m.umaReward),
    umaResolutionStatus: m.umaResolutionStatus,
    gammaRaw: storeRaw ? m.raw : null,
    updatedAtVenue: m.updatedAt,
    capturedAt,
  };
  const { id: _id, venueId: _v, externalId: _e, ...updatable } = row;
  await db
    .insert(markets)
    .values(row)
    .onConflictDoUpdate({ target: markets.id, set: updatable });

  // Append-only rules versions: new row only when the normalized hash changes.
  const text = m.description;
  if (text.trim().length === 0) return { newRulesVersion: false };
  const hash = rulesTextHash(text);
  const latest = await db
    .select({ versionNum: rulesVersions.versionNum, textHash: rulesVersions.textHash })
    .from(rulesVersions)
    .where(eq(rulesVersions.marketId, id))
    .orderBy(desc(rulesVersions.versionNum))
    .limit(1);
  const latestRow = latest[0];
  if (latestRow && latestRow.textHash === hash) return { newRulesVersion: false };
  const versionNum = (latestRow?.versionNum ?? 0) + 1;
  await db.insert(rulesVersions).values({
    marketId: id,
    versionNum,
    textHash: hash,
    rulesText: text,
    source: "gamma_description",
    // v1 is best-attributed to listing; later versions to the venue's updatedAt.
    occurredAt: versionNum === 1 ? m.createdAt : (m.updatedAt ?? capturedAt),
    capturedAt,
  });
  if (versionNum > 1) {
    await appendAudit(db, {
      actor: ACTOR,
      action: "rules_version.appended",
      entity: "market",
      entityId: id,
      payload: { versionNum, textHash: hash },
    });
  }
  return { newRulesVersion: true };
}

/** Count helper used by tests and the report. */
export async function countMarkets(db: Db): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(markets)
    .where(and(eq(markets.venueId, VENUE_POLYMARKET)));
  return rows[0]?.n ?? 0;
}
