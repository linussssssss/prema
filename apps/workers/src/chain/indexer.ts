import { eq } from "drizzle-orm";
import { hexToString, keccak256, stringToHex, type Hex, type PublicClient } from "viem";
import { appendAudit, ingestState, resolutionEvents, votes, type Db } from "@verdict/schema";
import { DATASET_START } from "../config.ts";
import { logger } from "../lib/log.ts";
import {
  ADAPTER_ADDRESSES,
  ETHEREUM_CONTRACTS,
  POLYGON_CONTRACTS,
  adapterAbi,
  ctfAbi,
  oracleLabelFor,
  oov2Abi,
  votingV2Abi,
} from "./config.ts";
import {
  chunkTimeInterpolator,
  findBlockByTimestamp,
  forEachAdaptiveRange,
  makeClient,
  type ChainName,
} from "./client.ts";

const ACTOR = "ingest-chain";
const CONFIRMATIONS: Record<ChainName, bigint> = { polygon: 300n, ethereum: 32n };
const INITIAL_SPAN: Record<ChainName, bigint> = { polygon: 50_000n, ethereum: 50_000n };

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

function serializeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "bigint") out[k] = v.toString();
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "bigint" ? x.toString() : x));
    else out[k] = v;
  }
  return out;
}

function ancillaryUtf8(hex: Hex | undefined): string | null {
  if (!hex) return null;
  try {
    return hexToString(hex).slice(0, 16_384);
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
  const client = makeClient("polygon");
  const managedOracle = await resolveManagedOracle(client);
  const ooAddresses = [POLYGON_CONTRACTS.oov2, ...(managedOracle ? [managedOracle] : [])] as Hex[];
  logger.info({ managedOracle }, managedOracle ? "managed oracle resolved on-chain" : "no managed oracle found; indexing OOv2 only");

  const stateKey = "chain:polygon:lastBlock";
  const head = (await client.getBlock({ blockTag: "latest" })).number - CONFIRMATIONS.polygon;
  const { startBlock, fromRecent } = await resolveStartBlock(db, client, stateKey, head, opts);
  const capped = opts.maxBlocks !== undefined && startBlock + opts.maxBlocks < head;
  const endBlock = capped ? startBlock + opts.maxBlocks! : head;

  let eventsStored = 0;
  const adapterLower = ADAPTER_ADDRESSES.map((a) => a.toLowerCase() as Hex);

  await forEachAdaptiveRange(
    { fromBlock: startBlock, toBlock: endBlock },
    { initialSpan: INITIAL_SPAN.polygon, label: "polygon" },
    async (chunk) => {
      const pending: PendingEvent[] = [];

      // 1) Adapter lifecycle events (questionID-indexed).
      const adapterLogs = await client.getLogs({
        address: adapterLower,
        events: adapterAbi.filter((x) => x.type === "event"),
        ...chunk,
      });
      // 2) OO requests initiated by the adapters (requester is indexed on all three).
      const ooLogs = (
        await Promise.all(
          oov2Abi.map((event) =>
            client.getLogs({ address: ooAddresses, event, args: { requester: adapterLower }, ...chunk }),
          ),
        )
      ).flat();
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
  const client = makeClient("ethereum");
  const stateKey = "chain:ethereum:lastBlock";
  const head = (await client.getBlock({ blockTag: "latest" })).number - CONFIRMATIONS.ethereum;
  const { startBlock, fromRecent } = await resolveStartBlock(db, client, stateKey, head, opts);
  const capped = opts.maxBlocks !== undefined && startBlock + opts.maxBlocks < head;
  const endBlock = capped ? startBlock + opts.maxBlocks! : head;

  let eventsStored = 0;
  let votesStored = 0;

  await forEachAdaptiveRange(
    { fromBlock: startBlock, toBlock: endBlock },
    { initialSpan: INITIAL_SPAN.ethereum, label: "ethereum" },
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
