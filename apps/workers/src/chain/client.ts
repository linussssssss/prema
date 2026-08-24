import {
  createPublicClient,
  fallback,
  http,
  numberToHex,
  type Chain,
  type Hex,
  type PublicClient,
  type RpcLog,
} from "viem";
import { mainnet, polygon } from "viem/chains";
import { logger } from "../lib/log.ts";

export type ChainName = "polygon" | "ethereum";

/** Keyless PublicNode endpoints: emergency fallback only (recent blocks; deep
 *  history may not be served). Primary/secondary come from .env (ADR-0002). */
const PUBLIC_FALLBACKS: Record<ChainName, string> = {
  polygon: "https://polygon-bor-rpc.publicnode.com",
  ethereum: "https://ethereum-rpc.publicnode.com",
};

const CHAINS: Record<ChainName, Chain> = { polygon, ethereum: mainnet };

/**
 * Accept either a full RPC URL or a bare API key. A bare key is expanded to
 * the provider URL for its slot per ADR-0002 (primary=Infura, fallback=
 * Alchemy). Provider URL formats verified 2026-08. If a slot ever uses a
 * different provider, put the full https:// URL in .env and it's used as-is.
 */
export function toRpcUrl(value: string, slot: "primary" | "fallback", chain: ChainName): string {
  if (value.includes("://")) return value;
  if (slot === "primary") {
    return chain === "polygon"
      ? `https://polygon-mainnet.infura.io/v3/${value}`
      : `https://mainnet.infura.io/v3/${value}`;
  }
  return chain === "polygon"
    ? `https://polygon-mainnet.g.alchemy.com/v2/${value}`
    : `https://eth-mainnet.g.alchemy.com/v2/${value}`;
}

/** The primary (Infura, per ADR-0002) URL for a chain, or null if unset. */
export function primaryRpcUrlFor(chain: ChainName): string | null {
  const primary = chain === "polygon" ? process.env.POLYGON_RPC_URL : process.env.ETHEREUM_RPC_URL;
  return primary && primary.length > 0 ? toRpcUrl(primary, "primary", chain) : null;
}

export function rpcUrlsFor(chain: ChainName): string[] {
  const secondary =
    chain === "polygon" ? process.env.POLYGON_RPC_URL_FALLBACK : process.env.ETHEREUM_RPC_URL_FALLBACK;
  const urls: string[] = [];
  const primary = primaryRpcUrlFor(chain);
  if (primary) urls.push(primary);
  if (secondary && secondary.length > 0) urls.push(toRpcUrl(secondary, "fallback", chain));
  if (urls.length === 0) {
    logger.warn({ chain }, "no RPC URL configured; using keyless PublicNode fallback (recent blocks only)");
    urls.push(PUBLIC_FALLBACKS[chain]);
  }
  return urls;
}

/**
 * Response cap for the deep sweep. viem defaults `maxResponseBodySize` to
 * 10 MiB, and the 2026-08-23 probe showed that biting *before* Infura's own
 * 10k-log rule: 6,250-block chunks overflowed the body cap while carrying only
 * ~8k logs, so the sweep kept halving for a client-side reason rather than a
 * provider one, and never used the range ADR-0002 actually bought us. At the
 * ~1.3 KB/log measured there, a full 10k-log response is ~13 MiB; 64 MiB puts
 * the provider's contract back in charge with generous headroom while still
 * bounding how much a single response can allocate.
 */
export const BACKFILL_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

/**
 * Request timeout for the deep sweep. viem defaults to 10s, which is a
 * sensible web-request default and far too short for these: a 10,000-block
 * `eth_getLogs` in the dense 2026 ranges returns thousands of logs carrying
 * full ancillary text, and was observed taking 5-26s per chunk before timing
 * out and killing the run at block 82.59M on 2026-08-24.
 */
export const BACKFILL_TIMEOUT_MS = 120_000;

export interface ClientOptions {
  /**
   * Build from the primary (Infura) URL alone — no `fallback()` transport.
   * For the deep historical sweep: Alchemy free caps `eth_getLogs` at ~10
   * blocks, so failing over to it mid-backfill can't serve the range and only
   * burns retries and credits (ADR-0013). Live head-tailing, which uses small
   * ranges the fallback *can* serve, keeps the default.
   */
  primaryOnly?: boolean | undefined;
  /** Override viem's 10 MiB response cap; see BACKFILL_MAX_RESPONSE_BYTES. */
  maxResponseBodySize?: number | false | undefined;
  /** Override viem's 10s request timeout; see BACKFILL_TIMEOUT_MS. */
  timeout?: number | undefined;
}

export function makeClient(chain: ChainName, opts: ClientOptions = {}): PublicClient {
  let urls = rpcUrlsFor(chain);
  if (opts.primaryOnly) {
    const primary = primaryRpcUrlFor(chain);
    if (primary) urls = [primary];
    else
      logger.warn(
        { chain },
        "primaryOnly requested but no primary RPC URL configured; deep getLogs ranges may not be servable",
      );
  }
  const transports = urls.map((url) =>
    http(url, {
      retryCount: 3,
      retryDelay: 500,
      ...(opts.maxResponseBodySize !== undefined ? { maxResponseBodySize: opts.maxResponseBodySize } : {}),
      ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
    }),
  );
  return createPublicClient({
    chain: CHAINS[chain],
    transport: transports.length > 1 ? fallback(transports) : transports[0]!,
  });
}

/**
 * Raw `eth_getLogs` with hand-built topics.
 *
 * viem's `getLogs` cannot express "any of these events AND this indexed
 * argument": passing `events` (plural) makes it drop `args` entirely
 * (`args: events_ ? undefined : args` in its source), which would silently
 * widen the filter to every event on the contract rather than erroring. So the
 * OO query is issued at the JSON-RPC level, where topic0 and topic1 can both
 * be OR-sets. Returns undecoded logs; the caller decodes.
 */
export async function getLogsByTopics(
  client: PublicClient,
  params: { address: Hex[]; topics: Array<Hex[] | Hex | null>; fromBlock: bigint; toBlock: bigint },
): Promise<RpcLog[]> {
  return client.request({
    method: "eth_getLogs",
    params: [
      {
        address: params.address,
        topics: params.topics,
        fromBlock: numberToHex(params.fromBlock),
        toBlock: numberToHex(params.toBlock),
      },
    ],
  } as never) as Promise<RpcLog[]>;
}

/** Binary-search the first block with timestamp >= target. */
export async function findBlockByTimestamp(client: PublicClient, target: Date): Promise<bigint> {
  const targetTs = BigInt(Math.floor(target.getTime() / 1000));
  let lo = 1n;
  let hi = (await client.getBlock({ blockTag: "latest" })).number;
  const genesis = await client.getBlock({ blockNumber: lo });
  if (genesis.timestamp >= targetTs) return lo;
  while (lo + 1n < hi) {
    const mid = (lo + hi) / 2n;
    const block = await client.getBlock({ blockNumber: mid });
    if (block.timestamp >= targetTs) hi = mid;
    else lo = mid;
  }
  return hi;
}

export interface LogRange {
  fromBlock: bigint;
  toBlock: bigint;
}

/** viem surfaces a 429 as the generic "HTTP request failed", so match the
 *  status and the provider wordings rather than the wrapper text. */
const RATE_LIMITED = /\b429\b|too many requests|rate limit|throttl/i;

/**
 * The network went away — DNS failure, reset connection, unreachable host.
 * Distinct from a range error (the request was too big) and from a rate limit
 * (we asked too often): here the request never happened at all, so shrinking
 * the span or giving up both throw away a resumable run for no reason.
 *
 * The case this exists for: a laptop sleeping mid-sweep. On wake the first
 * request fires before DNS is back and dies with ENOTFOUND, killing a job that
 * was hours in. Observed 2026-08-24 at block 64.47M after a 6.5-hour sleep.
 */
const TRANSIENT_NETWORK = /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENETUNREACH|fetch failed|socket hang up/i;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fetch` over [fromBlock, toBlock] in adaptive chunks: start at
 * `initialSpan`, halve on provider range/size errors (Infura's 10k-log cap and
 * friends), grow after successes. Provider-agnostic by design (ADR-0002).
 *
 * Growth is capped by a remembered `ceiling` — the smallest span seen to
 * overflow here. Without it the loop is multiplicative in both directions:
 * every success grows 1.5x until the next failure, so it re-probes a span it
 * already knows is too big roughly every third chunk, and each of those probes
 * is a paid-for request that cannot succeed. The ceiling relaxes by 25% after
 * a run of `relaxAfter` clean chunks so the sweep can still widen when it
 * crosses into quieter block ranges (event density varies by orders of
 * magnitude across the backfill). ADR-0015.
 */
export async function forEachAdaptiveRange(
  range: LogRange,
  opts: {
    initialSpan: bigint;
    minSpan?: bigint;
    maxSpan?: bigint;
    label?: string;
    /** Clean chunks before the learned ceiling relaxes upward. */
    relaxAfter?: number;
    /** First rate-limit backoff; doubles per consecutive hit. */
    backoffMs?: number;
    maxRateLimitRetries?: number;
    /** Network-outage retries. Default 40 with a 5-minute cap ≈ 3h tolerated. */
    maxNetworkRetries?: number;
  },
  fetchChunk: (chunk: LogRange) => Promise<void>,
): Promise<void> {
  const minSpan = opts.minSpan ?? 128n;
  const maxSpan = opts.maxSpan ?? opts.initialSpan * 8n;
  const relaxAfter = opts.relaxAfter ?? 16;
  const backoffMs = opts.backoffMs ?? 2_000;
  const maxRateLimitRetries = opts.maxRateLimitRetries ?? 8;
  const maxNetworkRetries = opts.maxNetworkRetries ?? 40;
  let span = opts.initialSpan;
  let ceiling: bigint | null = null;
  let streak = 0;
  let rateLimitHits = 0;
  let networkHits = 0;
  let from = range.fromBlock;
  while (from <= range.toBlock) {
    const to = from + span - 1n > range.toBlock ? range.toBlock : from + span - 1n;
    try {
      await fetchChunk({ fromBlock: from, toBlock: to });
      from = to + 1n;
      streak += 1;
      rateLimitHits = 0; // fresh backoff budget for the next throttle
      networkHits = 0;
      if (ceiling !== null && streak >= relaxAfter) {
        ceiling = (ceiling * 5n) / 4n;
        streak = 0;
      }
      let next = (span * 3n) / 2n;
      // Stay a margin below what already failed rather than rediscovering it.
      if (ceiling !== null && next > (ceiling * 7n) / 8n) next = (ceiling * 7n) / 8n;
      if (next > maxSpan) next = maxSpan;
      if (next < minSpan) next = minSpan;
      span = next;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A rate limit is NOT a range problem, and shrinking on one makes it
      // strictly worse: smaller chunks mean more requests mean more throttling.
      // Observed as a death spiral (2929 -> 128 blocks, then failure) because
      // viem reports a 429 as the generic "HTTP request failed". Back off in
      // time and retry the same span instead.
      if (RATE_LIMITED.test(msg)) {
        if (rateLimitHits >= maxRateLimitRetries) throw err;
        const waitMs = backoffMs * 2 ** rateLimitHits;
        rateLimitHits += 1;
        logger.warn(
          { label: opts.label, waitMs, attempt: rateLimitHits, span: span.toString() },
          "rate limited; backing off without shrinking",
        );
        await sleep(waitMs);
        continue;
      }
      // Checked before the range test on purpose: "timeout" appears in both
      // patterns, but a request that never left the machine is not evidence
      // that the range was too wide.
      if (TRANSIENT_NETWORK.test(msg)) {
        if (networkHits >= maxNetworkRetries) throw err;
        // Capped exponential: quick retries for a blip, then a steady 5-minute
        // poll so a long outage (a sleeping laptop) is waited out rather than
        // failing a run that is hours in and fully resumable.
        const waitMs = Math.min(backoffMs * 2 ** networkHits, 300_000);
        networkHits += 1;
        logger.warn(
          { label: opts.label, waitMs, attempt: networkHits, err: msg.slice(0, 120) },
          "network unavailable; waiting for it to come back",
        );
        await sleep(waitMs);
        continue;
      }
      // Providers disagree on how a too-big getLogs reads: Infura says
      // "more than 10000 results", others say "block range", PublicNode
      // returns a bare InvalidParams. Treat them all as shrinkable. Kept
      // deliberately narrow — a transient network failure must not be read as
      // a range error, or it would poison `ceiling` for the rest of the run.
      // `timed out` / `took too long` are viem's TimeoutError wording and mean
      // the query was too heavy to answer, not that the network failed — the
      // socket-level ETIMEDOUT is caught above. Matching only the token
      // "timeout" missed both phrasings and killed the sweep at block 82.59M
      // on 2026-08-24.
      const rangeError =
        /10000|10,000|range|too large|response size|limit|timeout|timed out|took too long|more than|invalid param/i.test(
          msg,
        );
      if (!rangeError || span <= minSpan) throw err;
      ceiling = span;
      streak = 0;
      span = span / 2n < minSpan ? minSpan : span / 2n;
      logger.warn({ label: opts.label, span: span.toString(), err: msg.slice(0, 160) }, "shrinking getLogs span");
    }
  }
}

/** Linear interpolation of block timestamps inside a chunk: exact enough for
 *  occurred_at (Polygon ~2s blocks), avoids one getBlock per log. */
export async function chunkTimeInterpolator(
  client: PublicClient,
  chunk: LogRange,
): Promise<(blockNumber: bigint) => Date> {
  const [first, last] = await Promise.all([
    client.getBlock({ blockNumber: chunk.fromBlock }),
    chunk.toBlock === chunk.fromBlock ? null : client.getBlock({ blockNumber: chunk.toBlock }),
  ]);
  const t0 = Number(first.timestamp);
  const t1 = last ? Number(last.timestamp) : t0;
  const b0 = Number(chunk.fromBlock);
  const b1 = Number(chunk.toBlock);
  return (blockNumber: bigint) => {
    const b = Number(blockNumber);
    const ts = b1 === b0 ? t0 : t0 + ((t1 - t0) * (b - b0)) / (b1 - b0);
    return new Date(Math.round(ts) * 1000);
  };
}
