import {
  createPublicClient,
  fallback,
  http,
  type Chain,
  type PublicClient,
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

export function rpcUrlsFor(chain: ChainName): string[] {
  const primary = chain === "polygon" ? process.env.POLYGON_RPC_URL : process.env.ETHEREUM_RPC_URL;
  const secondary =
    chain === "polygon" ? process.env.POLYGON_RPC_URL_FALLBACK : process.env.ETHEREUM_RPC_URL_FALLBACK;
  const urls = [primary, secondary].filter((u): u is string => Boolean(u && u.length > 0));
  if (urls.length === 0) {
    logger.warn({ chain }, "no RPC URL configured; using keyless PublicNode fallback (recent blocks only)");
    urls.push(PUBLIC_FALLBACKS[chain]);
  }
  return urls;
}

export function makeClient(chain: ChainName): PublicClient {
  const transports = rpcUrlsFor(chain).map((url) => http(url, { retryCount: 3, retryDelay: 500 }));
  return createPublicClient({
    chain: CHAINS[chain],
    transport: transports.length > 1 ? fallback(transports) : transports[0]!,
  });
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

/**
 * Run `fetch` over [fromBlock, toBlock] in adaptive chunks: start at
 * `initialSpan`, halve on provider range/size errors (Infura's 10k-log cap and
 * friends), grow 1.5x after successes. Provider-agnostic by design (ADR-0002).
 */
export async function forEachAdaptiveRange(
  range: LogRange,
  opts: { initialSpan: bigint; minSpan?: bigint; maxSpan?: bigint; label?: string },
  fetchChunk: (chunk: LogRange) => Promise<void>,
): Promise<void> {
  const minSpan = opts.minSpan ?? 128n;
  const maxSpan = opts.maxSpan ?? opts.initialSpan * 8n;
  let span = opts.initialSpan;
  let from = range.fromBlock;
  while (from <= range.toBlock) {
    const to = from + span - 1n > range.toBlock ? range.toBlock : from + span - 1n;
    try {
      await fetchChunk({ fromBlock: from, toBlock: to });
      from = to + 1n;
      span = span * 3n / 2n > maxSpan ? maxSpan : (span * 3n) / 2n;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const rangeError = /10000|10,000|range|too large|response size|limit|timeout|more than/i.test(msg);
      if (!rangeError || span <= minSpan) throw err;
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
