import { z } from "zod";
import { GAMMA_BASE } from "../config.ts";
import { politeJson } from "../lib/http.ts";
import { logger } from "../lib/log.ts";

/**
 * Gamma moved to keyset pagination (offset returns HTTP 422 since May 2026).
 * GET /markets/keyset?limit=100[&closed=true][&after_cursor=...]
 * → { markets: [...], next_cursor?: "..." }   (next_cursor absent on last page)
 * Response shapes verified live 2026-08-22; fixtures in data/fixtures/.
 */
const envelopeSchema = z.looseObject({
  markets: z.array(z.unknown()),
  next_cursor: z.string().optional(),
});

/** The subset of a Gamma market we rely on. Everything else rides along in `raw`. */
export interface GammaMarket {
  id: string;
  question: string;
  slug: string | null;
  description: string;
  category: string | null;
  tags: unknown[] | null;
  conditionId: string | null;
  questionId: string | null;
  negRisk: boolean;
  negRiskRequestId: string | null;
  resolvedBy: string | null;
  resolutionSource: string | null;
  outcomes: string[] | null;
  outcomePrices: number[] | null;
  clobTokenIds: string[] | null;
  endDate: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  startDate: Date | null;
  closedTime: Date | null;
  active: boolean | null;
  closed: boolean | null;
  volumeUsd: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  umaBond: number | null;
  umaReward: number | null;
  umaResolutionStatus: string | null;
  raw: Record<string, unknown>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const date = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** Gamma stringifies arrays ("[\"Yes\", \"No\"]"); tolerate both forms. */
const jsonArray = (v: unknown): unknown[] | null => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

function firstTagLabel(raw: Record<string, unknown>): string | null {
  const events = jsonArray(raw.events);
  const candidates: unknown[] = [raw.tags, events?.[0] && (events[0] as Record<string, unknown>).tags].filter(Boolean);
  for (const c of candidates) {
    const tags = jsonArray(c);
    const first = tags?.[0] as Record<string, unknown> | undefined;
    const label = first && (str(first.label) ?? str(first.slug));
    if (label) return label;
  }
  return null;
}

export function parseGammaMarket(input: unknown): GammaMarket | null {
  if (input === null || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const id = str(raw.id);
  const question = str(raw.question);
  if (!id || !question) return null;
  return {
    id,
    question,
    slug: str(raw.slug),
    description: str(raw.description) ?? "",
    category: str(raw.category) ?? firstTagLabel(raw),
    tags: jsonArray(raw.tags),
    conditionId: str(raw.conditionId),
    questionId: str(raw.questionID),
    negRisk: bool(raw.negRisk) ?? false,
    negRiskRequestId: str(raw.negRiskRequestID),
    resolvedBy: str(raw.resolvedBy),
    resolutionSource: str(raw.resolutionSource),
    outcomes: jsonArray(raw.outcomes)?.map(String) ?? null,
    outcomePrices: jsonArray(raw.outcomePrices)?.map(Number) ?? null,
    clobTokenIds: jsonArray(raw.clobTokenIds)?.map(String) ?? null,
    endDate: date(raw.endDate),
    createdAt: date(raw.createdAt),
    updatedAt: date(raw.updatedAt),
    startDate: date(raw.startDate),
    closedTime: date(raw.closedTime),
    active: bool(raw.active),
    closed: bool(raw.closed),
    volumeUsd: num(raw.volumeNum) ?? num(raw.volume),
    liquidityUsd: num(raw.liquidityNum) ?? num(raw.liquidity),
    volume24h: num(raw.volume24hr),
    umaBond: num(raw.umaBond),
    umaReward: num(raw.umaReward),
    umaResolutionStatus: str(raw.umaResolutionStatus) ?? lastUmaStatus(raw),
    raw,
  };
}

function lastUmaStatus(raw: Record<string, unknown>): string | null {
  const statuses = jsonArray(raw.umaResolutionStatuses);
  const last = statuses?.[statuses.length - 1];
  if (typeof last === "string") return last;
  if (last && typeof last === "object") return str((last as Record<string, unknown>).status);
  return null;
}

export interface MarketsPage {
  markets: GammaMarket[];
  nextCursor: string | undefined;
  invalidCount: number;
}

export async function fetchMarketsPage(params: {
  afterCursor?: string | undefined;
  limit?: number;
  closed?: boolean | undefined;
  ascending?: boolean;
}): Promise<MarketsPage> {
  const url = new URL(`${GAMMA_BASE}/markets/keyset`);
  url.searchParams.set("limit", String(params.limit ?? 100));
  url.searchParams.set("order", "id");
  url.searchParams.set("ascending", String(params.ascending ?? true));
  url.searchParams.set("include_tag", "true");
  if (params.closed !== undefined) url.searchParams.set("closed", String(params.closed));
  if (params.afterCursor) url.searchParams.set("after_cursor", params.afterCursor);

  const body = await politeJson(url.toString());
  const envelope = envelopeSchema.parse(body);
  const markets: GammaMarket[] = [];
  let invalidCount = 0;
  for (const item of envelope.markets) {
    const parsed = parseGammaMarket(item);
    if (parsed) markets.push(parsed);
    else {
      invalidCount++;
      logger.warn({ item: JSON.stringify(item).slice(0, 200) }, "unparseable gamma market");
    }
  }
  return { markets, nextCursor: envelope.next_cursor, invalidCount };
}
