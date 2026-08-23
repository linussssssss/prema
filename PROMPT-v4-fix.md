# PROMPT — V4 adapter fix + backfill-recovery code

Paste this into a fresh Claude Code session (start it small — do NOT continue a
long, large-context session; each turn there is expensive). It is self-contained.

---

You are the founding engineer on **Verdict** (public name **Prema**), a neutral
resolution layer for prediction markets. Repo: this directory. **Read first, in
order:** `STATUS.md`, `RECOVERY.md`, `CLAUDE.md`, and `docs/DECISIONS.md`
(especially ADR-0012). Then do the task below.

## Goal

Make the on-chain indexer correctly and economically re-capture Polygon oracle
events including the **V4 adapters**, and make the deep backfill robust — WITHOUT
launching the expensive multi-hour re-scan yourself. You write and verify code;
the founder triggers the re-scan.

## Context (established facts — do not re-derive or re-verify from scratch)

- The first full backfill **completed Gamma** (2,615,958 markets, 2.6M rules
  versions, in Postgres) but **Polygon indexing died at exit 127** (~block
  61.9M, ~31k events). Exit 127 is an external process death (machine sleep /
  session teardown), not a code bug. The indexer checkpoints
  `chain:polygon:lastBlock` in `ingest_state` per chunk and inserts are
  idempotent on `(chain, tx_hash, log_index)`, so it is resumable.
- The `resolved_by` distribution revealed **V4 adapters** — `ctfAdapterV4`
  (`0x65070be91477460d8A7AeEb94ef92fE056C2f2A7`) and `negRiskAdapterV4`
  (`0x69c47De9d4d3daD79590d61b9e05918e03775F24`) — resolving ~1.88M of 2.62M
  markets. The dead run predates them, so its partial Polygon data is missing
  them. **A full Polygon re-scan with V4 included is required** (the 61.9M
  checkpoint is poisoned: resuming from it would miss all V4 history before
  61.9M).
- **Already done — do NOT redo:** `apps/workers/src/chain/config.ts` already
  registers the V4 adapters in `POLYGON_CONTRACTS`, `ADAPTER_ADDRESSES`, and
  `oracleLabelFor`; `resolveManagedOracle()` in
  `apps/workers/src/chain/indexer.ts` already probes the V4 adapters first;
  ADR-0012 is written. Verify these are present (they should be) and build on
  them; do not duplicate.
- The Polygon logs also show thrash against the **Alchemy fallback**
  ("JSON is not a valid request object"). Alchemy's free tier caps `eth_getLogs`
  at ~10 blocks and cannot serve the deep ranges the backfill uses, so failing
  over to it during the historical sweep just wastes retries. RPC config: bare
  keys in `../.env` (one level above the repo) — Infura is primary,
  Alchemy is the fallback (see ADR-0002 / ADR-0011). `loadEnv()` reads them.

## Tasks (code only — nothing that launches the re-scan)

1. **Infura-only transport for the deep backfill.** In
   `apps/workers/src/chain/client.ts`, extend `makeClient(chain)` with an option
   like `makeClient(chain, { primaryOnly?: boolean })` that, when `primaryOnly`,
   builds the client from the **primary (Infura) URL only** — no `fallback()`.
   Use `primaryOnly: true` in both `indexPolygon` and `indexEthereum`
   (`apps/workers/src/chain/indexer.ts`). Keep the normal fallback behavior for
   any live/head-tailing use. Rationale: stop the Alchemy thrash and wasted
   retries on a provider that can't serve deep getLogs ranges.

2. **Explicit cursor reset.** Add a `resetChainCursor(db, chain)` helper
   (exported from `indexer.ts`) that deletes the `chain:<chain>:lastBlock` row
   from `ingest_state`, and wire a `--reset-cursor` flag into the
   `apps/workers/src/cli/ingest-chain.ts` CLI (resetting the selected `--chain`,
   or both when `--chain all`). Do NOT hand-edit the database — the reset must
   be an auditable code path. This lets the founder clear the poisoned Polygon
   checkpoint before the V4 re-scan.

3. **ADR.** Add `ADR-0013` to `docs/DECISIONS.md` recording the Infura-only
   backfill-transport decision (alternatives: keep fallback — rejected because
   Alchemy free can't serve deep ranges and the failover wasted retries/credits).

4. **Do NOT** implement the "combine the 3 OO getLogs into 1 via manual topics"
   optimization here. It needs careful manual topic encoding and mainnet
   testing; a wrong encoding would silently drop events. Leave it as a
   separately-tested follow-up (noted in RECOVERY.md 0.3(b)).

## Guardrails (from CLAUDE.md — non-negotiable)

- Append-only for decision-relevant rows; never `UPDATE` them. (`ingest_state`
  is operational bookkeeping and may be updated/deleted — that's what task 2 does.)
- Verify external addresses/ABIs against sources, not memory (the V4 addresses
  are already verified via Polygonscan public-name tags, cited in config.ts).
- `pnpm lint && pnpm typecheck && pnpm test` must be green before you call it
  done. Add/adjust tests if you change public behavior.
- Small, conventional commit(s); push to `origin main`.
- **Do NOT launch the re-scan or any multi-hour / credit-heavy job.** Infura
  free is 3M credits/day; a full Polygon sweep is ~3 free-tier days.

## Verify

- `pnpm typecheck` + `pnpm test` green.
- Optionally, a cheap sanity check that `makeClient("polygon", { primaryOnly:
  true })` builds and does a single `getBlockNumber()` (one RPC call, negligible
  credits) — confirms the Infura key path still works.
- Full V4 event-decode confirmation happens naturally in the first chunks of the
  founder-run re-scan (watch the log for `polygon chunk indexed` with nonzero
  `logs` on V4 addresses); `resolveManagedOracle` logs if a V4
  `optimisticOracle()` call fails.

## Hand back to the founder (do NOT run these yourself)

State that the fix is committed and give the exact re-scan procedure from
`RECOVERY.md` §0.3:
```
pnpm --filter @verdict/workers run ingest:chain -- --reset-cursor --chain polygon
DATASET_SKIP_GAMMA=1 pnpm dataset:build          # chain + linter + labels + export
pnpm --filter @verdict/data run validate         # sanity gate, MOOv2, join rate
```
…and remind them of the credit reality and the three ways to fit it (spread over
days / getLogs optimization / one paid Alchemy month — the last is a spend
decision). Prevent machine sleep during the run (the exit-127 cause).
