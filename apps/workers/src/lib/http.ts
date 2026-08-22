import { logger } from "./log.ts";

const lastRequestAt = new Map<string, number>();

export interface PoliteFetchOptions {
  /** Minimum ms between requests to the same host (politeness). */
  minIntervalMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch JSON with per-host rate limiting and exponential backoff on
 * 429/5xx/network errors. Throws after maxRetries.
 */
export async function politeJson(url: string, opts: PoliteFetchOptions = {}): Promise<unknown> {
  const { minIntervalMs = 250, maxRetries = 5, timeoutMs = 30_000 } = opts;
  const host = new URL(url).host;

  for (let attempt = 0; ; attempt++) {
    const waitUntil = (lastRequestAt.get(host) ?? 0) + minIntervalMs;
    const now = Date.now();
    if (now < waitUntil) await sleep(waitUntil - now);
    lastRequestAt.set(host, Date.now());

    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json", "user-agent": "verdict-ingest/0.1 (research; contact: repo owner)" },
      });
      if (res.status === 429 || res.status >= 500) {
        throw new RetryableError(`HTTP ${res.status} from ${host}`);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
      }
      return (await res.json()) as unknown;
    } catch (err) {
      const retryable =
        err instanceof RetryableError ||
        (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError" || err.message.includes("fetch failed")));
      if (!retryable || attempt >= maxRetries) throw err;
      const backoff = Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 250;
      logger.warn({ url, attempt, backoff: Math.round(backoff) }, "retrying request");
      await sleep(backoff);
    }
  }
}

class RetryableError extends Error {}
