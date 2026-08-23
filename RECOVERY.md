# RECOVERY.md — backfill recovery & coming phases (2026-08-23)

Plan for the phases ahead, starting with the V4-adapter fix. Companion to
`STATUS.md` (state), `TODO.md` (backlog), `docs/DECISIONS.md` (ADR-0012 = V4
adapters). Cost note up front: don't auto-launch multi-hour / credit-heavy
jobs — the founder triggers re-scans (Infura free = 3M credits/day).

## What happened

- First full uncapped backfill: **Gamma completed** (2,615,958 markets, 2.6M
  rules versions). **Polygon died at exit 127** (~block 61.9M, ~31k events) —
  exit 127 is an external process death (machine sleep / session teardown),
  not a code bug. It is resumable (per-chunk cursor + idempotent inserts).
- Separately, the `resolved_by` distribution revealed **V4 adapters**
  (`ctfAdapterV4 0x6507…`, `negRiskAdapterV4 0x69c4…`) resolving ~1.88M of
  2.62M markets — the bulk of the ambiguous tail. The dead run predates V4, so
  its partial Polygon data is missing them. config.ts + `resolveManagedOracle`
  now include V4 (ADR-0012); `umaSportsOracle` (~5.7k sports markets,
  `MULTIPLE_VALUES` identifier) is deferred.
- Polygon logs also show thrash against the **Alchemy fallback**
  ("JSON is not a valid request object") — Alchemy free can't serve deep
  getLogs ranges, so failing over to it during the backfill wastes retries.

## Phase 0 — V4 fix + backfill recovery (NOW)

**0.1 Code — DONE 2026-08-23** (`PROMPT-v4-fix.md`; ADR-0013, quality gate
green, one-call Infura sanity check passed):
- Backfill uses the **Infura primary transport only** (no Alchemy fallback for
  the deep sweep) — stops the thrash and wasted retries. Fallback stays for
  live head-tailing (small ranges). [ADR-0013]
- Add `ingest-chain --reset-cursor` to clear the poisoned
  `chain:polygon:lastBlock` explicitly (auditable, not a hand DB edit). The
  61.9M checkpoint predates V4, so a resume would miss V4 history — a full
  re-scan with V4 included is required. Events dedupe on
  `(chain, tx, log_index)`, so re-scanning already-seen blocks is a safe no-op.
- Keep the 2.6M Gamma markets — re-run with `DATASET_SKIP_GAMMA=1`.

**0.2 Verify (cheap):** V4 event decode is confirmed by the re-run's first
chunks (watch the log); `resolveManagedOracle` logs if a V4 `optimisticOracle()`
call fails. Addresses were verified by the other session via Polygonscan
public-name tags (cited in config.ts).

**0.3 Re-scan (FOUNDER-TRIGGERED — credit-sensitive):**
```
pnpm --filter @verdict/workers run ingest:chain -- --reset-cursor --chain polygon
DATASET_SKIP_GAMMA=1 pnpm dataset:build      # chain + linter + labels + export
```
- **Credit reality — measured, then improved: ~3.2M credits, ~1 free-tier day**
  after ADR-0018 cut the OO calls from 3 to 1 (it was ~5.2M / ~2 days). Infura caps `eth_getLogs` at **10,000 blocks regardless of
  result size** (measured: a near-empty query failed at 15,625 blocks and
  succeeded at 7,812). ADR-0002 had recorded "any range under 10k logs", which
  was wrong, and every cost estimate rested on it. The cap is a hard floor:
  40.7M blocks ÷ 10k = ~4,070 chunks × 5 getLogs ≈ 20,350 calls ≈ 5.2M
  credits. ADR-0015's tunings reduce wasted probes but cannot beat the floor.
  (An intermediate revision here claiming ~1.3M credits / one day was wrong —
  it assumed 400k-block chunks Infura will not serve. See ADR-0016.)
- **Also real: ~10–17 GB** of JSON to pull, parse and insert (~10M logs at the
  measured ~1.3 KB/log). Keep the machine awake (the exit-127 cause).
- Worst case is bounded: 3M credits/day is a ceiling, so overrunning costs
  more days, never a bill. It is resumable across days at no extra cost.
- **Ways to fit sooner (pick one, ask before spending):**
  (a) spread over days — free, default, just re-run daily;
  (b) ~~fewer-getLogs optimization~~ — **DONE 2026-08-23 (ADR-0018).** The 3 OO
      calls are now 1, so a chunk costs 3 getLogs instead of 5: **~40% fewer
      credits, ~3.2M total, which fits the sweep in a single free day.**
      Verified by running both forms over three real ranges and comparing
      result sets — identical on all three, 8,316 logs including the rare
      DisputePrice events;
  (c) Alchemy Pay As You Go — **no longer "one paid month"**: Growth/Scale
      became usage-based on 2025-02-01. $0.45/1M CU, no platform fee, no
      documented minimum, and a dashboard usage cap. getLogs = 60 CU with
      *unlimited* block ranges (150 MB responses) vs Infura's 10k-log cap,
      so ~5x fewer, larger calls. At this job's size that is **cents — on the
      order of $0.05, low single-digit dollars even if the estimate is 10x
      off**. Cheap insurance if the credit ceiling turns out to bind; it does
      not remove the GB-transfer floor, so do not expect hours-vs-days.

**0.4 Finish:** linter (2.6M rules versions already present) → labels → export
→ REPORT.md.

## Phase 1 — Validate & sanity-check

- `pnpm --filter @verdict/data run validate`: dispute sanity gate (~1,000+
  Jan–May 2026), oracle-mechanism distribution (MOOv2 now answerable via V4
  `optimisticOracle()`), questionId join rate, audit-chain integrity.
- Smoke-test the post-mortem generator on one real dispute.
- If disputes are still low after V4: suspect the UmaSportsOracle gap or the
  OO `requester` filter — compare against known disputes on Polygonscan.
- Note: `rules_edited_after_listing` will read ~0 from a one-pass crawl
  (each market seen once → only v1 stored); needs the re-poll worker over time.

## Phase 2 — UmaSportsOracle (deferred)

~5.7k multi-outcome sports markets, `MULTIPLE_VALUES` identifier, a distinct
event path from `YES_OR_NO_QUERY`. Add only if the sports tail matters for the
ambiguity thesis; otherwise document the exclusion in REPORT.md.

## Phase 3 — Freshness + product (per TODO P1)

- Re-poll worker for open markets → `rules_edited_after_listing` gains signal.
- Ancillary-data v1 rules reconstruction → de-censors pre-crawl edits.
- Then Phase-1 product: LLM clause extractor, calibrated score, `/calibration`.

## Cost discipline (this run and going forward)

- Founder triggers re-scans; no auto-launch of multi-hour/credit-heavy jobs.
- Prevent machine sleep during long runs (the exit-127 cause).
- Avoid persistent monitors / background instrumentation on long jobs — each
  wake-up is a full-context model request; check logs by hand instead.
