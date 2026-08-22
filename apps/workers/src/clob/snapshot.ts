import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { appendAudit, marketMetrics, markets, type Db } from "@verdict/schema";
import { CLOB_BASE } from "../config.ts";
import { politeJson } from "../lib/http.ts";
import { logger } from "../lib/log.ts";

const ACTOR = "snapshot-clob";

export interface SnapshotStats {
  attempted: number;
  stored: number;
}

/**
 * Cheap hourly snapshot: order book top for the top-N open markets by 24h
 * volume. /book shape verified live 2026-08-22 (data/fixtures/clob-book.json).
 */
export async function snapshotTopMarkets(db: Db, opts: { topN?: number } = {}): Promise<SnapshotStats> {
  const topN = opts.topN ?? 200;
  const candidates = await db
    .select({ id: markets.id, clobTokenIds: markets.clobTokenIds })
    .from(markets)
    .where(and(eq(markets.active, true), eq(markets.closed, false), isNotNull(markets.clobTokenIds)))
    .orderBy(desc(sql`${markets.volume24h}::numeric`))
    .limit(topN);

  const stats: SnapshotStats = { attempted: 0, stored: 0 };
  for (const market of candidates) {
    const token = Array.isArray(market.clobTokenIds) ? (market.clobTokenIds as string[])[0] : undefined;
    if (!token) continue;
    stats.attempted++;
    try {
      const book = (await politeJson(`${CLOB_BASE}/book?token_id=${token}`, { minIntervalMs: 150 })) as {
        timestamp?: string;
        bids?: Array<{ price: string }>;
        asks?: Array<{ price: string }>;
      };
      const bestBid = (book.bids ?? []).reduce<number | null>((acc, b) => {
        const p = Number(b.price);
        return acc === null || p > acc ? p : acc;
      }, null);
      const bestAsk = (book.asks ?? []).reduce<number | null>((acc, a) => {
        const p = Number(a.price);
        return acc === null || p < acc ? p : acc;
      }, null);
      const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
      const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
      await db.insert(marketMetrics).values({
        marketId: market.id,
        source: "clob",
        mid: mid !== null ? String(mid) : null,
        spread: spread !== null ? String(spread) : null,
        bestBid: bestBid !== null ? String(bestBid) : null,
        bestAsk: bestAsk !== null ? String(bestAsk) : null,
        occurredAt: book.timestamp ? new Date(Number(book.timestamp)) : new Date(),
        capturedAt: new Date(),
      });
      stats.stored++;
    } catch (err) {
      logger.warn({ market: market.id, err: String(err).slice(0, 120) }, "book snapshot failed");
    }
  }
  await appendAudit(db, {
    actor: ACTOR,
    action: "clob.snapshot",
    entity: "market_metrics",
    payload: stats as unknown as Record<string, unknown>,
  });
  return stats;
}
