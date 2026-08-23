import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  ambiguityLabels,
  appendAudit,
  disputes,
  markets,
  marketMetrics,
  resolutionEvents,
  rulesVersions,
  sha256Hex,
  votes,
  type Db,
} from "@verdict/schema";
import { LABEL_VERSION } from "../config.ts";
import { logger } from "../lib/log.ts";

const ACTOR = "label";
/** Markets per round trip. See ADR-0019 — the corpus does not fit in memory. */
const MARKET_BATCH = 20_000;

export interface LabelStats {
  marketsLabeled: number;
  labelsAppended: number;
  disputesUpserted: number;
  disputedMarkets: number;
  escalatedMarkets: number;
  resolvedNaMarkets: number;
  rulesEditedMarkets: number;
  contestedMarkets: number;
}

interface EventRow {
  eventName: string;
  oracle: string;
  questionId: string | null;
  conditionId: string | null;
  blockTime: Date | null;
  args: Record<string, unknown>;
}

/** Payout vector like [1,1] (or [x,x,...] all equal, >2 slots) = venue "invalid"/50-50. */
export function isFiftyFifty(payouts: unknown): boolean {
  if (!Array.isArray(payouts) || payouts.length < 2) return false;
  const nums = payouts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return false;
  const first = nums[0]!;
  return first > 0 && nums.every((n) => n === first);
}

export async function computeLabels(db: Db): Promise<LabelStats> {
  const stats: LabelStats = {
    marketsLabeled: 0,
    labelsAppended: 0,
    disputesUpserted: 0,
    disputedMarkets: 0,
    escalatedMarkets: 0,
    resolvedNaMarkets: 0,
    rulesEditedMarkets: 0,
    contestedMarkets: 0,
  };

  // --- Lookup maps from venue data -----------------------------------------
  // Streamed rather than loaded whole: the corpus is ~2.6M markets, and holding
  // the rows *and* the derived maps at once needs multiple GB (ADR-0019). The
  // venue-side resolved_na check is folded into the same pass so the rows never
  // have to be retained.
  const byQuestionId = new Map<string, string>();
  const byConditionId = new Map<string, string>();
  const venueNaMarketIds = new Set<string>();
  {
    let cursor = "";
    for (;;) {
      const rows = await db
        .select({
          id: markets.id,
          questionId: markets.questionId,
          conditionId: markets.conditionId,
          closed: markets.closed,
          outcomePrices: markets.outcomePrices,
        })
        .from(markets)
        .where(gt(markets.id,cursor))
        .orderBy(asc(markets.id))
        .limit(MARKET_BATCH);
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id;
      for (const m of rows) {
        if (m.questionId) byQuestionId.set(m.questionId, m.id);
        if (m.conditionId) byConditionId.set(m.conditionId, m.id);
        // Venue-side fallback: closed markets whose final prices are exactly 0.5/0.5.
        if (m.closed && Array.isArray(m.outcomePrices) && m.outcomePrices.length === 2) {
          const [a, b] = m.outcomePrices as number[];
          if (a === 0.5 && b === 0.5) venueNaMarketIds.add(m.id);
        }
      }
      if (rows.length < MARKET_BATCH) break;
    }
  }

  // --- Disputes from DisputePrice events -----------------------------------
  const disputeEvents = (await db
    .select({
      eventName: resolutionEvents.eventName,
      oracle: resolutionEvents.oracle,
      questionId: resolutionEvents.questionId,
      conditionId: resolutionEvents.conditionId,
      blockTime: resolutionEvents.blockTime,
      args: resolutionEvents.args,
    })
    .from(resolutionEvents)
    .where(inArray(resolutionEvents.eventName, ["DisputePrice", "Settle"]))) as EventRow[];

  const requestKeyOf = (e: EventRow): string =>
    sha256Hex(`${e.questionId ?? "?"}|${String(e.args.timestamp ?? "?")}`);

  const disputeByKey = new Map<string, EventRow>();
  const settleByKey = new Map<string, EventRow>();
  for (const e of disputeEvents) {
    if (e.eventName === "DisputePrice") disputeByKey.set(requestKeyOf(e), e);
    else settleByKey.set(requestKeyOf(e), e);
  }

  // --- Escalation: DVM activity joined by request time + ancillary prefix ---
  const dvmResolved = (await db
    .select({
      eventName: resolutionEvents.eventName,
      oracle: resolutionEvents.oracle,
      questionId: resolutionEvents.questionId,
      conditionId: resolutionEvents.conditionId,
      blockTime: resolutionEvents.blockTime,
      args: resolutionEvents.args,
    })
    .from(resolutionEvents)
    .where(eq(resolutionEvents.oracle, "votingv2"))) as EventRow[];
  const voteRows = await db
    .select({ requestTime: votes.requestTime, ancillaryHash: votes.ancillaryHash })
    .from(votes);

  const dvmTimes = new Set<number>();
  for (const e of dvmResolved) {
    const t = Number(e.args.time ?? NaN);
    if (Number.isFinite(t)) dvmTimes.add(t);
  }
  for (const v of voteRows) {
    if (v.requestTime) dvmTimes.add(Math.floor(v.requestTime.getTime() / 1000));
  }

  const disputedMarketIds = new Set<string>();
  const escalatedMarketIds = new Set<string>();
  for (const [key, e] of disputeByKey) {
    const marketId = e.questionId ? (byQuestionId.get(e.questionId) ?? null) : null;
    if (marketId) disputedMarketIds.add(marketId);
    const settle = settleByKey.get(key);
    const requestTime = Number(e.args.timestamp ?? NaN);
    // A disputed request whose timestamp shows up at the DVM was escalated.
    // Polymarket request timestamps are block timestamps of initialize(), so
    // collisions across markets are possible but rare; acceptable for label v1
    // and refined in the report by ancillary prefix when present.
    const escalated = Number.isFinite(requestTime) && dvmTimes.has(requestTime);
    if (escalated && marketId) escalatedMarketIds.add(marketId);

    await db
      .insert(disputes)
      .values({
        marketId,
        questionId: e.questionId,
        requestKey: key,
        oracleAddress: null,
        oracle: e.oracle,
        proposer: (e.args.proposer as string | undefined)?.toLowerCase() ?? null,
        disputer: (e.args.disputer as string | undefined)?.toLowerCase() ?? null,
        proposedPrice: e.args.proposedPrice !== undefined ? String(e.args.proposedPrice) : null,
        disputedAt: e.blockTime,
        settledPrice: settle?.args.price !== undefined ? String(settle.args.price) : null,
        settledAt: settle?.blockTime ?? null,
        escalated,
        capturedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: disputes.requestKey,
        set: {
          settledPrice: settle?.args.price !== undefined ? String(settle.args.price) : null,
          settledAt: settle?.blockTime ?? null,
          escalated,
          marketId,
          capturedAt: new Date(),
        },
      });
    stats.disputesUpserted++;
  }

  // --- resolved_na from on-chain payout vectors ----------------------------
  const naMarketIds = new Set<string>();
  const resolutionRows = (await db
    .select({
      eventName: resolutionEvents.eventName,
      oracle: resolutionEvents.oracle,
      questionId: resolutionEvents.questionId,
      conditionId: resolutionEvents.conditionId,
      blockTime: resolutionEvents.blockTime,
      args: resolutionEvents.args,
    })
    .from(resolutionEvents)
    .where(
      inArray(resolutionEvents.eventName, ["ConditionResolution", "QuestionResolved", "QuestionManuallyResolved"]),
    )) as EventRow[];
  for (const e of resolutionRows) {
    const payouts = (e.args.payoutNumerators ?? e.args.payouts) as unknown;
    if (!isFiftyFifty(payouts)) continue;
    const marketId =
      (e.conditionId && byConditionId.get(e.conditionId)) ||
      (e.questionId && byQuestionId.get(e.questionId)) ||
      null;
    if (marketId) naMarketIds.add(marketId);
  }
  for (const id of venueNaMarketIds) naMarketIds.add(id); // computed in the streaming pass above

  // --- rules_edited_after_listing ------------------------------------------
  const edited = await db
    .select({ marketId: rulesVersions.marketId })
    .from(rulesVersions)
    .groupBy(rulesVersions.marketId)
    .having(gt(sql<number>`count(*)`, 1));
  const editedMarketIds = new Set(edited.map((r) => r.marketId));

  // --- price_reversal (auxiliary; null when no metrics exist) --------------
  const reversalMarketIds = new Map<string, boolean>();
  const metricMarkets = await db
    .selectDistinct({ marketId: marketMetrics.marketId })
    .from(marketMetrics);
  // Fetch just these markets rather than scanning the corpus per metric market:
  // the previous `marketRows.find()` inside this loop was O(metrics x 2.6M).
  const metricIds = metricMarkets.map((m) => m.marketId);
  const metricMarketRows =
    metricIds.length === 0
      ? []
      : await db
          .select({
            id: markets.id,
            closed: markets.closed,
            closedTime: markets.closedTime,
            endDate: markets.endDate,
            outcomePrices: markets.outcomePrices,
          })
          .from(markets)
          .where(inArray(markets.id, metricIds));
  const metricMarketById = new Map(metricMarketRows.map((m) => [m.id, m]));
  for (const { marketId } of metricMarkets) {
    const market = metricMarketById.get(marketId);
    const closeAt = market?.closedTime ?? market?.endDate ?? null;
    if (!market || !market.closed || !closeAt || !Array.isArray(market.outcomePrices)) continue;
    const dayBefore = new Date(closeAt.getTime() - 24 * 3600 * 1000);
    const lastMetrics = await db
      .select({ mid: marketMetrics.mid, occurredAt: marketMetrics.occurredAt })
      .from(marketMetrics)
      .where(
        and(
          eq(marketMetrics.marketId, marketId),
          gt(marketMetrics.occurredAt, dayBefore),
        ),
      )
      .orderBy(asc(marketMetrics.occurredAt));
    const mids = lastMetrics
      .filter((r) => r.occurredAt <= closeAt && r.mid !== null)
      .map((r) => Number(r.mid));
    if (mids.length === 0) continue;
    const lastMid = mids[mids.length - 1]!;
    const settledYes = Number((market.outcomePrices as number[])[0]) === 1;
    const reversal = (lastMid > 0.8 && !settledYes) || (lastMid < 0.2 && settledYes);
    reversalMarketIds.set(marketId, reversal);
  }

  // --- Compose + append labels (only when changed) -------------------------
  // Only the fingerprint fields, not whole rows — this map spans every labeled
  // market and the unused columns are pure overhead at corpus scale.
  const latestLabels = new Map<string, string>();
  const existing = await db
    .select({
      marketId: ambiguityLabels.marketId,
      disputed: ambiguityLabels.disputed,
      escalated: ambiguityLabels.escalated,
      resolvedNa: ambiguityLabels.resolvedNa,
      rulesEditedAfterListing: ambiguityLabels.rulesEditedAfterListing,
      priceReversal: ambiguityLabels.priceReversal,
      labelVersion: ambiguityLabels.labelVersion,
    })
    .from(ambiguityLabels)
    .orderBy(asc(ambiguityLabels.id));
  for (const l of existing) {
    latestLabels.set(
      l.marketId,
      [l.disputed, l.escalated, l.resolvedNa, l.rulesEditedAfterListing, l.priceReversal, l.labelVersion].join("|"),
    );
  }

  let batch: (typeof ambiguityLabels.$inferInsert)[] = [];
  // Second streaming pass: the label decision needs only the market id.
  let labelCursor = "";
  for (;;) {
  const marketIdRows = await db
    .select({ id: markets.id })
    .from(markets)
    .where(gt(markets.id,labelCursor))
    .orderBy(asc(markets.id))
    .limit(MARKET_BATCH);
  if (marketIdRows.length === 0) break;
  labelCursor = marketIdRows[marketIdRows.length - 1]!.id;
  for (const m of marketIdRows) {
    const disputed = disputedMarketIds.has(m.id);
    const escalated = escalatedMarketIds.has(m.id);
    const resolvedNa = naMarketIds.has(m.id);
    const rulesEdited = editedMarketIds.has(m.id);
    const priceReversal = reversalMarketIds.has(m.id) ? reversalMarketIds.get(m.id)! : null;
    const contested = disputed || escalated || resolvedNa || rulesEdited;
    stats.marketsLabeled++;
    if (disputed) stats.disputedMarkets++;
    if (escalated) stats.escalatedMarkets++;
    if (resolvedNa) stats.resolvedNaMarkets++;
    if (rulesEdited) stats.rulesEditedMarkets++;
    if (contested) stats.contestedMarkets++;

    const fingerprint = [disputed, escalated, resolvedNa, rulesEdited, priceReversal, LABEL_VERSION].join("|");
    if (latestLabels.get(m.id) === fingerprint) continue;
    batch.push({
      marketId: m.id,
      disputed,
      escalated,
      resolvedNa,
      rulesEditedAfterListing: rulesEdited,
      contested,
      priceReversal,
      labelVersion: LABEL_VERSION,
      computedAt: new Date(),
    });
    if (batch.length >= 500) {
      await db.insert(ambiguityLabels).values(batch);
      stats.labelsAppended += batch.length;
      batch = [];
    }
  }
  if (marketIdRows.length < MARKET_BATCH) break;
  }
  if (batch.length > 0) {
    await db.insert(ambiguityLabels).values(batch);
    stats.labelsAppended += batch.length;
  }

  await appendAudit(db, {
    actor: ACTOR,
    action: "labels.computed",
    entity: "ambiguity_labels",
    entityId: LABEL_VERSION,
    payload: stats as unknown as Record<string, unknown>,
  });
  logger.info(stats, "labels computed");
  return stats;
}
