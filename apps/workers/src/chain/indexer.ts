import { eq } from "drizzle-orm";
import {
  decodeEventLog,
  hexToBigInt,
  hexToNumber,
  hexToString,
  keccak256,
  pad,
  stringToHex,
  type Hex,
  type PublicClient,
  type RpcLog,
} from "viem";
import { appendAudit, ingestState, resolutionEvents, votes, type Db } from "@verdict/schema";
import { DATASET_START } from "../config.ts";
import { logger } from "../lib/log.ts";
import {
  ADAPTER_ADDRESSES,
  ETHEREUM_CONTRACTS,
  OO_EVENT_TOPICS,
  POLYGON_CONTRACTS,
  adapterAbi,
  ctfAbi,
  oracleLabelFor,
  oov2Abi,
  votingV2Abi,
} from "./config.ts";
import {
  BACKFILL_MAX_RESPONSE_BYTES,
  BACKFILL_TIMEOUT_MS,
  chunkTimeInterpolator,
  findBlockByTimestamp,
  forEachAdaptiveRange,
  getLogsByTopics,
  makeClient,
  type ChainName,
} from "./client.ts";

const ACTOR = "ingest-chain";
const CONFIRMATIONS: Record<ChainName, bigint> = { polygon: 300n, ethereum: 32n };
/**
 * Where the adaptive sweep starts probing. Polygon's Polymarket traffic makes
 * 50,000 blocks hopeless in the dense recent ranges — the 2026-08-23 probe
 * burned four failed halvings (50k→25k→12.5k→6.25k) before its first success
 * at ~3k, and every one of those was a paid request that could not succeed.
 * Ethereum's VotingV2 YES_OR_NO_QUERY traffic is sparse, so it opens straight
 * at the provider cap. Both grow toward MAX_SPAN from here (ADR-0015/0016).
 */
const INITIAL_SPAN: Record<ChainName, bigint> = { polygon: 4_000n, ethereum: 10_000n };
/**
 * Explicit, because forEachAdaptiveRange otherwise derives it as initialSpan*8.
 * 10,000 is Infura's hard `eth_getLogs` block-range cap, measured 2026-08-23:
 * a near-empty query (one event, one address) still returned InvalidParams at
 * 15,625 blocks and succeeded at 7,812. This corrects ADR-0002's reading that
 * any range is allowed below 10k logs — the block cap applies regardless of
 * how few logs come back, and it is the floor under the whole sweep's cost.
 * Anything above this is unreachable, so probing higher only wastes calls.
 */
const MAX_SPAN: Record<ChainName, bigint> = { polygon: 10_000n, ethereum: 10_000n };

const YES_OR_NO_IDENTIFIER = stringToHex("YES_OR_NO_QUERY", { size: 32 });

export interface IndexOptions {
  /** Cap blocks scanned this run (demo/CI). Undefined = catch up to head. */
  maxBlocks?: bigint | undefined;
}

export interface IndexStats {
  chain: ChainName;
  fromBlock: string;
  toBlock: string;
  eventsStored: number;
  votesStored: number;
  managedOracle: string | null;
  complete: boolean;
}

export function serializeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "bigint") out[k] = v.toString();
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "bigint" ? x.toString() : stripNul(x)));
    // Every string that reaches jsonb goes through stripNul, not just the
    // decoded ancillary: one NUL anywhere fails the whole batch insert, and
    // finding out which field carried it costs a backfill.
    else out[k] = stripNul(v);
  }
  return out;
}

/**
 * Postgres cannot store U+0000 in `text` or `jsonb` — it rejects the entire
 * insert with SQLSTATE 22P05. UMA pads fixed-width fields with NUL bytes, so
 * decoded ancillary data carries them ("YES_OR_NO_QUERY" plus 17 NULs to fill
 * bytes32). That killed a backfill at ~61% on 2026-08-24 and would have
 * recurred at the same block on every resume.
 *
 * The NULs are padding, never content, and the raw bytes are still kept in
 * `args.ancillaryData` — so stripping is lossless for anything we rely on.
 */
/** U+0000 as a value, not a literal: an invisible control character in source
 *  is mangled by formatters and editors without warning. */
const NUL = String.fromCharCode(0);

function stripNul<T>(value: T): T {
  if (typeof value === "string") return value.split(NUL).join("") as T;
  if (Array.isArray(value)) return value.map(stripNul) as T;
  return value;
}

export function ancillaryUtf8(hex: Hex | undefined): string | null {
  if (!hex) return null;
  try {
    return stripNul(hexToString(hex)).slice(0, 16_384);
  } catch {
    return null;
  }
}

/**
 * The adapter's `optimisticOracle` is a public immutable (verified in
 * UmaCtfAdapter.sol). Whatever v3/NegRisk point at *today* is the live oracle —
 * post-UMIP-189 that is the ManagedOptimisticOracleV2. MOOV2_ADDRESS in .env
 * overrides; a result equal to plain OOv2 means the migration hasn't reached
 * that adapter.
 */
export async function resolveManagedOracle(client: PublicClient): Promise<string | null> {
  if (process.env.MOOV2_ADDRESS) return process.env.MOOV2_ADDRESS.toLowerCase();
  const candidates = new Set<string>();
  // Probe the *current* (V4) adapters first — they resolve most markets and
  // point at today's live oracle; older adapters may still point at OOv2.
  for (const adapter of [
    POLYGON_CONTRACTS.ctfAdapterV4,
    POLYGON_CONTRACTS.negRiskAdapterV4,
    POLYGON_CONTRACTS.ctfAdapterV3,
    POLYGON_CONTRACTS.negRiskAdapter,
  ]) {
    try {
      const oracle = await client.readContract({
        address: adapter as Hex,
        abi: adapterAbi,
        functionName: "optimisticOracle",
      });
      candidates.add((oracle as string).toLowerCase());
    } catch (err) {
      logger.warn({ adapter, err: String(err).slice(0, 120) }, "optimisticOracle() call failed");
    }
  }
  candidates.delete(POLYGON_CONTRACTS.oov2.toLowerCase());
  const [managed] = candidates;
  return managed ?? null;
}

/** Single source of truth for the cursor key, so a reset and an index run can
 *  never disagree about which row they mean. */
export function chainStateKey(chain: ChainName): string {
  return `chain:${chain}:lastBlock`;
}

export interface CursorReset {
  chain: ChainName;
  key: string;
  /** The cursor that was cleared, or null if none was stored. */
  previousBlock: string | null;
}

/**
 * Clear a chain's stored `lastBlock` cursor so the next run restarts from the
 * 2024 boundary. `ingest_state` is operational bookkeeping, not
 * decision-relevant, so deleting here is allowed (CLAUDE.md) — but it must go
 * through this code path rather than a hand DB edit, and it appends to the
 * audit log so the reset is on the record.
 *
 * Used to discard the Polygon checkpoint that predates the V4 adapters
 * (ADR-0012): resuming from it would skip all V4 history below it. Re-scanning
 * already-seen blocks is a safe no-op — events dedupe on
 * `(chain, tx_hash, log_index)`.
 */
export async function resetChainCursor(db: Db, chain: ChainName): Promise<CursorReset> {
  const key = chainStateKey(chain);
  const previous = await getStateBlock(db, key);
  await db.delete(ingestState).where(eq(ingestState.key, key));
  await appendAudit(db, {
    actor: ACTOR,
    action: "index.cursor.reset",
    entity: "chain",
    entityId: chain,
    payload: { key, previousBlock: previous?.toString() ?? null },
  });
  return { chain, key, previousBlock: previous?.toString() ?? null };
}

/** Shape the rest of the indexer expects from a decoded log — the subset of
 *  viem's decoded `getLogs` output that `indexPolygon` actually reads. */
export interface DecodedLog {
  address: string;
  eventName: string;
  args: Record<string, unknown>;
  transactionHash: string;
  logIndex: number;
  blockNumber: bigint;
}

/**
 * Decode the raw OO logs from the combined topic query. A decode failure here
 * is not tolerable the way an adapter-v1 mismatch is: we selected these logs by
 * our own topic0 list, so anything that fails to decode means the ABI and the
 * selector disagree — log it loudly rather than dropping it silently.
 */
export function decodeOoLogs(raw: RpcLog[]): DecodedLog[] {
  const out: DecodedLog[] = [];
  for (const log of raw) {
    if (!log.transactionHash || log.logIndex === null || log.blockNumber === null) continue;
    try {
      const decoded = decodeEventLog({ abi: oov2Abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      out.push({
        address: log.address,
        eventName: decoded.eventName,
        args: (decoded.args ?? {}) as Record<string, unknown>,
        transactionHash: log.transactionHash,
        logIndex: hexToNumber(log.logIndex),
        blockNumber: hexToBigInt(log.blockNumber),
      });
    } catch (err) {
      logger.error(
        { topic0: log.topics[0], tx: log.transactionHash, err: String(err).slice(0, 160) },
        "OO log matched our topic filter but failed to decode",
      );
    }
  }
  return out;
}

/**
 * Seed a chain's cursor so the next run resumes from `block` instead of the
 * 2024 boundary. Same discipline as `resetChainCursor` (ADR-0013): an auditable
 * code path rather than a hand DB edit, with the reason recorded.
 *
 * Used to skip a range already known to be completely indexed. That is only
 * safe when the *adapter set* was unchanged over the skipped range — the reason
 * the cursor was reset in the first place was that the old checkpoint predated
 * the V4 adapters. Verify before using: the earliest V4-resolved market was
 * listed 2025-08-08, while the dead sweep's coverage ends 2024-09-17, so no V4
 * history exists below it.
 */
export async function setChainCursor(
  db: Db,
  chain: ChainName,
  block: bigint,
  reason: string,
): Promise<{ chain: ChainName; key: string; block: string; previousBlock: string | null }> {
  const key = chainStateKey(chain);
  const previous = await getStateBlock(db, key);
  await setStateBlock(db, key, block);
  await appendAudit(db, {
    actor: ACTOR,
    action: "index.cursor.set",
    entity: "chain",
    entityId: chain,
    payload: { key, block: block.toString(), previousBlock: previous?.toString() ?? null, reason },
  });
  return { chain, key, block: block.toString(), previousBlock: previous?.toString() ?? null };
}

async function getStateBlock(db: Db, key: string): Promise<bigint | null> {
  const rows = await db.select().from(ingestState).where(eq(ingestState.key, key));
  const value = rows[0]?.value as { lastBlock?: string } | undefined;
  return value?.lastBlock ? BigInt(value.lastBlock) : null;
}

async function setStateBlock(db: Db, key: string, block: bigint): Promise<void> {
  const value = { lastBlock: block.toString() };
  await db
    .insert(ingestState)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: ingestState.key, set: { value, updatedAt: new Date() } });
}

interface PendingEvent {
  chain: ChainName;
  contractAddress: string;
  oracle: string;
  eventName: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockTime: Date | null;
  questionId: string | null;
  conditionId: string | null;
  requester: string | null;
  args: Record<string, unknown>;
}

async function storeEvents(db: Db, rows: PendingEvent[]): Promise<number> {
  if (rows.length === 0) return 0;
  let stored = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => ({ ...r, capturedAt: new Date() }));
    const inserted = await db
      .insert(resolutionEvents)
      .values(batch)
      .onConflictDoNothing({ target: [resolutionEvents.chain, resolutionEvents.txHash, resolutionEvents.logIndex] })
      .returning({ id: resolutionEvents.id });
    stored += inserted.length;
  }
  return stored;
}

export async function indexPolygon(db: Db, opts: IndexOptions = {}): Promise<IndexStats> {
  // Deep sweep: primary (Infura) transport only — the free-tier fallback can't
  // serve these getLogs ranges, so failing over to it just burns retries
  // (ADR-0013) — and a raised body cap so chunk size is bounded by the
  // provider's 10k-log rule rather than viem's 10 MiB default (ADR-0015).
  const client = makeClient("polygon", {
    primaryOnly: true,
    maxResponseBodySize: BACKFILL_MAX_RESPONSE_BYTES,
    timeout: BACKFILL_TIMEOUT_MS,
  });
  const managedOracle = await resolveManagedOracle(client);
  const ooAddresses = [POLYGON_CONTRACTS.oov2, ...(managedOracle ? [managedOracle] : [])] as Hex[];
  logger.info({ managedOracle }, managedOracle ? "managed oracle resolved on-chain" : "no managed oracle found; indexing OOv2 only");

  const stateKey = chainStateKey("polygon");
  const head = (await client.getBlock({ blockTag: "latest" })).number - CONFIRMATIONS.polygon;
  const { startBlock, fromRecent } = await resolveStartBlock(db, client, stateKey, head, opts);
  const capped = opts.maxBlocks !== undefined && startBlock + opts.maxBlocks < head;
  const endBlock = capped ? startBlock + opts.maxBlocks! : head;

  let eventsStored = 0;
  const adapterLower = ADAPTER_ADDRESSES.map((a) => a.toLowerCase() as Hex);

  await forEachAdaptiveRange(
    { fromBlock: startBlock, toBlock: endBlock },
    // relaxAfter is well above the default: re-probing a width the provider
    // has already refused costs ~30s here (a failed heavy getLogs), not the
    // milliseconds a clean range error costs, so probe upward far less often.
    { initialSpan: INITIAL_SPAN.polygon, maxSpan: MAX_SPAN.polygon, relaxAfter: 48, label: "polygon" },
    async (chunk) => {
      const pending: PendingEvent[] = [];

      // 1) Adapter lifecycle events (questionID-indexed).
      const adapterLogs = await client.getLogs({
        address: adapterLower,
        events: adapterAbi.filter((x) => x.type === "event"),
        ...chunk,
      });
      // 2) OO requests initiated by the adapters. One call for all three events
      //    via hand-built topics (ADR-0018): topic0 ∈ {Propose,Dispute,Settle},
      //    topic1 ∈ adapters — `requester` is the first indexed arg on each.
      const ooLogs = decodeOoLogs(
        await getLogsByTopics(client, {
          address: ooAddresses,
          topics: [OO_EVENT_TOPICS, adapterLower.map((a) => pad(a, { size: 32 }))],
          ...chunk,
        }),
      );
      // 3) CTF resolutions where an adapter is the oracle.
      const ctfLogs = await client.getLogs({
        address: POLYGON_CONTRACTS.conditionalTokens as Hex,
        event: ctfAbi[0],
        args: { oracle: adapterLower },
        ...chunk,
      });

      const all = [...adapterLogs, ...ooLogs, ...ctfLogs];
      if (all.length > 0) {
        const timeOf = await chunkTimeInterpolator(client, chunk);
        for (const log of all) {
          const args = log.args as Record<string, unknown>;
          const isOo = "requester" in args;
          const ancillary = args.ancillaryData as Hex | undefined;
          pending.push({
            chain: "polygon",
            contractAddress: log.address.toLowerCase(),
            oracle:
              managedOracle && log.address.toLowerCase() === managedOracle
                ? "moov2"
                : oracleLabelFor(log.address),
            eventName: log.eventName ?? "unknown",
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            blockNumber: Number(log.blockNumber),
            blockTime: timeOf(log.blockNumber),
            // Adapter/CTF events carry questionID directly; for OO events
            // questionID == keccak256(ancillaryData) (verified: UmaCtfAdapter
            // initialize() sets questionID = keccak256(appended ancillary)).
            questionId:
              (args.questionID as string | undefined)?.toLowerCase() ??
              (args.questionId as string | undefined)?.toLowerCase() ??
              (isOo && ancillary ? keccak256(ancillary).toLowerCase() : null),
            conditionId: (args.conditionId as string | undefined)?.toLowerCase() ?? null,
            requester: (args.requester as string | undefined)?.toLowerCase() ?? null,
            args: {
              ...serializeArgs(args),
              ...(ancillary ? { ancillaryDataUtf8: ancillaryUtf8(ancillary) } : {}),
            },
          });
        }
      }
      eventsStored += await storeEvents(db, pending);
      await setStateBlock(db, stateKey, chunk.toBlock);
      logger.info(
        { chunk: `${chunk.fromBlock}-${chunk.toBlock}`, logs: all.length, eventsStored },
        "polygon chunk indexed",
      );
    },
  );

  await appendAudit(db, {
    actor: ACTOR,
    action: "index.polygon.range",
    entity: "chain",
    entityId: "polygon",
    payload: { fromBlock: startBlock.toString(), toBlock: endBlock.toString(), eventsStored, managedOracle },
  });
  return {
    chain: "polygon",
    fromBlock: startBlock.toString(),
    toBlock: endBlock.toString(),
    eventsStored,
    votesStored: 0,
    managedOracle,
    complete: !capped && !fromRecent,
  };
}

/**
 * Start block resolution: stored cursor wins; otherwise the 2024-01-01
 * boundary. DATASET_CHAIN_FROM_RECENT=1 (demo runs, keyless RPCs that don't
 * serve deep history) starts at head-maxBlocks instead and marks the run
 * incomplete so REPORT.md says so.
 */
async function resolveStartBlock(
  db: Db,
  client: PublicClient,
  stateKey: string,
  head: bigint,
  opts: IndexOptions,
): Promise<{ startBlock: bigint; fromRecent: boolean }> {
  const stored = await getStateBlock(db, stateKey);
  if (stored !== null) return { startBlock: stored, fromRecent: false };
  if (process.env.DATASET_CHAIN_FROM_RECENT === "1" && opts.maxBlocks !== undefined) {
    return { startBlock: head - opts.maxBlocks, fromRecent: true };
  }
  return { startBlock: await findBlockByTimestamp(client, DATASET_START), fromRecent: false };
}

export async function indexEthereum(db: Db, opts: IndexOptions = {}): Promise<IndexStats> {
  // Deep sweep; see indexPolygon.
  const client = makeClient("ethereum", {
    primaryOnly: true,
    maxResponseBodySize: BACKFILL_MAX_RESPONSE_BYTES,
    timeout: BACKFILL_TIMEOUT_MS,
  });
  const stateKey = chainStateKey("ethereum");
  const head = (await client.getBlock({ blockTag: "latest" })).number - CONFIRMATIONS.ethereum;
  const { startBlock, fromRecent } = await resolveStartBlock(db, client, stateKey, head, opts);
  const capped = opts.maxBlocks !== undefined && startBlock + opts.maxBlocks < head;
  const endBlock = capped ? startBlock + opts.maxBlocks! : head;

  let eventsStored = 0;
  let votesStored = 0;

  await forEachAdaptiveRange(
    { fromBlock: startBlock, toBlock: endBlock },
    { initialSpan: INITIAL_SPAN.ethereum, maxSpan: MAX_SPAN.ethereum, label: "ethereum" },
    async (chunk) => {
      // All escalated YES_OR_NO_QUERY requests (identifier is indexed on both
      // events). Superset of Polymarket; narrowed at join time by ancillary prefix.
      const [resolved, revealed] = await Promise.all([
        client.getLogs({
          address: ETHEREUM_CONTRACTS.votingV2 as Hex,
          event: votingV2Abi[0],
          args: { identifier: YES_OR_NO_IDENTIFIER },
          ...chunk,
        }),
        client.getLogs({
          address: ETHEREUM_CONTRACTS.votingV2 as Hex,
          event: votingV2Abi[1],
          args: { identifier: YES_OR_NO_IDENTIFIER },
          ...chunk,
        }),
      ]);

      if (resolved.length + revealed.length > 0) {
        const timeOf = await chunkTimeInterpolator(client, chunk);
        const pending: PendingEvent[] = resolved.map((log) => {
          const args = log.args as Record<string, unknown>;
          const ancillary = args.ancillaryData as Hex | undefined;
          return {
            chain: "ethereum" as const,
            contractAddress: log.address.toLowerCase(),
            oracle: "votingv2",
            eventName: log.eventName ?? "RequestResolved",
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            blockNumber: Number(log.blockNumber),
            blockTime: timeOf(log.blockNumber),
            questionId: null,
            conditionId: null,
            requester: null,
            args: {
              ...serializeArgs(args),
              ancillaryHash: ancillary ? keccak256(ancillary).toLowerCase() : null,
            },
          };
        });
        eventsStored += await storeEvents(db, pending);

        for (let i = 0; i < revealed.length; i += 500) {
          const batch = revealed.slice(i, i + 500).map((log) => {
            const args = log.args as {
              voter?: string;
              roundId?: number;
              time?: bigint;
              ancillaryData?: Hex;
              price?: bigint;
              numTokens?: bigint;
            };
            return {
              identifier: "YES_OR_NO_QUERY",
              requestTime: args.time !== undefined ? new Date(Number(args.time) * 1000) : null,
              ancillaryHash: args.ancillaryData ? keccak256(args.ancillaryData).toLowerCase() : null,
              voter: args.voter?.toLowerCase() ?? null,
              price: args.price !== undefined ? args.price.toString() : null,
              numTokens: args.numTokens !== undefined ? args.numTokens.toString() : null,
              roundId: args.roundId ?? null,
              txHash: log.transactionHash,
              logIndex: log.logIndex,
              occurredAt: timeOf(log.blockNumber),
              capturedAt: new Date(),
            };
          });
          const inserted = await db
            .insert(votes)
            .values(batch)
            .onConflictDoNothing({ target: [votes.txHash, votes.logIndex] })
            .returning({ id: votes.id });
          votesStored += inserted.length;
        }
      }
      await setStateBlock(db, stateKey, chunk.toBlock);
      logger.info(
        { chunk: `${chunk.fromBlock}-${chunk.toBlock}`, resolved: resolved.length, revealed: revealed.length },
        "ethereum chunk indexed",
      );
    },
  );

  await appendAudit(db, {
    actor: ACTOR,
    action: "index.ethereum.range",
    entity: "chain",
    entityId: "ethereum",
    payload: { fromBlock: startBlock.toString(), toBlock: endBlock.toString(), eventsStored, votesStored },
  });
  return {
    chain: "ethereum",
    fromBlock: startBlock.toString(),
    toBlock: endBlock.toString(),
    eventsStored,
    votesStored,
    managedOracle: null,
    complete: !capped && !fromRecent,
  };
}
