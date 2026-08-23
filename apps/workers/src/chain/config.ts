import { encodeEventTopics, parseAbi, type Hex } from "viem";

/**
 * All addresses verified 2026-08-22 against primary sources:
 *  - Adapters: docs.polymarket.com resolution page (v1/v2/v3) and Polygonscan
 *    public name tag for the NegRisk adapter.
 *  - OOv2 / VotingV2 / Finder: UMAprotocol/protocol networks/{137,1}.json.
 *  - ConditionalTokens: Polygonscan "Polymarket: Conditional Tokens" label.
 * Addresses are stored EIP-55 checksummed: viem rejects a mixed-case literal
 * whose checksum doesn't match ("Address ... is invalid"), which silently broke
 * every readContract on the V4 adapters until 2026-08-23 (see ADR-0014).
 * `chain.test.ts` pins this for all of them.
 * Event signatures verified against source in:
 *  - Polymarket/uma-ctf-adapter src/interfaces/IUmaCtfAdapter.sol
 *  - UMAprotocol/protocol OptimisticOracleV2Interface.sol
 *  - gnosis/conditional-tokens-contracts ConditionalTokens.sol
 *  - UMAprotocol/protocol VotingV2.sol
 */
export const POLYGON_CONTRACTS = {
  ctfAdapterV1: "0xCB1822859cEF82Cd2Eb4E6276C7916e692995130",
  ctfAdapterV2: "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74",
  ctfAdapterV3: "0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49",
  // V4 adapters (Polygonscan public name tags "Polymarket: UMA CTF Adapter V4"
  // / "... Neg Risk UMA CTF Adapter V4") — discovered 2026-08-23 from the
  // markets.resolved_by distribution: these two resolve ~1.88M of 2.62M
  // markets (the bulk of current markets incl. most of the ambiguous tail),
  // and postdate Polymarket's docs. See ADR-0012.
  ctfAdapterV4: "0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7",
  negRiskAdapterV4: "0x69c47De9D4D3Dad79590d61b9e05918E03775f24",
  negRiskAdapter: "0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d",
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
  oov2: "0xeE3Afe347D5C74317041E2618C49534dAf887c24",
  // UmaSportsOracle (multi-outcome sports, MULTIPLE_VALUES identifier — a
  // different mechanism from YES_OR_NO_QUERY). ~5.7k sports markets; its OO
  // events aren't captured by the YES_OR_NO_QUERY path. Deferred (ADR-0012).
  umaSportsOracle: "0xb21182d0494521Cf45DbbeEbb5A3ACAAb6d22093",
  // ManagedOptimisticOracleV2 (UMIP-189, late 2025): no published address found in
  // UMA docs/repos. Resolved at runtime by calling optimisticOracle() on the
  // live adapters (public immutable), or set MOOV2_ADDRESS in .env to pin it.
  // See resolveManagedOracle().
  moov2: null as string | null,
} as const;

export const ETHEREUM_CONTRACTS = {
  votingV2: "0x004395edb43EFca9885CEdad51EC9fAf93Bd34ac",
} as const;

export const ADAPTER_ADDRESSES = [
  POLYGON_CONTRACTS.ctfAdapterV1,
  POLYGON_CONTRACTS.ctfAdapterV2,
  POLYGON_CONTRACTS.ctfAdapterV3,
  POLYGON_CONTRACTS.ctfAdapterV4,
  POLYGON_CONTRACTS.negRiskAdapterV4,
  POLYGON_CONTRACTS.negRiskAdapter,
] as const;

export function oracleLabelFor(address: string): string {
  const a = address.toLowerCase();
  if (a === POLYGON_CONTRACTS.ctfAdapterV1.toLowerCase()) return "ctf_adapter_v1";
  if (a === POLYGON_CONTRACTS.ctfAdapterV2.toLowerCase()) return "ctf_adapter_v2";
  if (a === POLYGON_CONTRACTS.ctfAdapterV3.toLowerCase()) return "ctf_adapter_v3";
  if (a === POLYGON_CONTRACTS.ctfAdapterV4.toLowerCase()) return "ctf_adapter_v4";
  if (a === POLYGON_CONTRACTS.negRiskAdapterV4.toLowerCase()) return "neg_risk_adapter_v4";
  if (a === POLYGON_CONTRACTS.negRiskAdapter.toLowerCase()) return "neg_risk_adapter";
  if (a === POLYGON_CONTRACTS.oov2.toLowerCase()) return "oov2";
  if (a === POLYGON_CONTRACTS.conditionalTokens.toLowerCase()) return "ctf";
  if (a === ETHEREUM_CONTRACTS.votingV2.toLowerCase()) return "votingv2";
  return "unknown";
}

// --- ABIs (events only, plus the adapter's oracle getter) -------------------

export const adapterAbi = parseAbi([
  "event QuestionInitialized(bytes32 indexed questionID, uint256 indexed requestTimestamp, address indexed creator, bytes ancillaryData, address rewardToken, uint256 reward, uint256 proposalBond)",
  "event QuestionResolved(bytes32 indexed questionID, int256 indexed settledPrice, uint256[] payouts)",
  "event QuestionManuallyResolved(bytes32 indexed questionID, uint256[] payouts)",
  "event QuestionReset(bytes32 indexed questionID)",
  "event QuestionFlagged(bytes32 indexed questionID)",
  "function optimisticOracle() view returns (address)",
]);

export const oov2Abi = parseAbi([
  "event ProposePrice(address indexed requester, address indexed proposer, bytes32 identifier, uint256 timestamp, bytes ancillaryData, int256 proposedPrice, uint256 expirationTimestamp, address currency)",
  "event DisputePrice(address indexed requester, address indexed proposer, address indexed disputer, bytes32 identifier, uint256 timestamp, bytes ancillaryData, int256 proposedPrice)",
  "event Settle(address indexed requester, address indexed proposer, address indexed disputer, bytes32 identifier, uint256 timestamp, bytes ancillaryData, int256 price, uint256 payout)",
]);

/**
 * topic0 for each OO event, so all three can be fetched in one `eth_getLogs`
 * instead of three (ADR-0018).
 *
 * This is only sound because `requester` is the **first indexed parameter on
 * all three** events — ProposePrice(requester, proposer, ...),
 * DisputePrice(requester, proposer, disputer, ...) and
 * Settle(requester, proposer, disputer, ...) — so it always lands in topic1 and
 * a single topic1 OR-set filters every one of them identically. If an event is
 * ever added here whose first indexed arg is something else, this collapses
 * silently and must not be used. `chain.test.ts` pins both the selectors and
 * that invariant.
 */
export const OO_EVENT_TOPICS = oov2Abi.map(
  (event) => encodeEventTopics({ abi: [event], eventName: event.name })[0] as Hex,
);

export const ctfAbi = parseAbi([
  "event ConditionResolution(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint256 outcomeSlotCount, uint256[] payoutNumerators)",
]);

export const votingV2Abi = parseAbi([
  "event RequestResolved(uint32 indexed roundId, uint256 indexed resolvedPriceRequestIndex, bytes32 indexed identifier, uint256 time, bytes ancillaryData, int256 price)",
  "event VoteRevealed(address indexed voter, address indexed caller, uint32 roundId, bytes32 indexed identifier, uint256 time, bytes ancillaryData, int256 price, uint128 numTokens)",
]);
