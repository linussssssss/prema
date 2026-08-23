# TODO — Verdict

Ordered backlog with enough context to execute each item cold. Read
`STATUS.md` first. Conventions in `CLAUDE.md`; scope in `docs/PLAN.md`;
decisions in `docs/DECISIONS.md`. Rules that bind every item: verify external
facts against docs/live responses before coding; append-only for anything
decision-relevant; never fabricate report numbers; record new decisions as
ADRs as you go; `pnpm lint && pnpm typecheck && pnpm test` before "done".

## P0 — unblock the full dataset (founder actions) — DONE 2026-08-23

- [x] **Free RPC keys** — Infura (primary) + Alchemy (fallback) bare keys in
      `../.env`; both chains verified with a live getBlockNumber. `.env` is
      loaded by `loadEnv()` (ADR-0011); bare keys expand to provider URLs.
- [x] **Docker** — installed; needed `wsl --install` + reboot (firmware virt
      was already on). `docker compose up -d` runs Postgres/Redis/MinIO;
      schema migrated into Postgres. Docker CLI is at
      `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe` (per-user
      install, not on PATH by default).
- [x] **GitHub push** — `origin` = github.com/linussssssss/prema, `main`
      pushed, CI armed.

## P0 — first full backfill run (RE-SCAN PENDING FOUNDER TRIGGER 2026-08-23)

- [x] **Gamma pass complete** — 2,615,958 markets + 2.6M rules versions in
      Postgres. Keep them: re-run the chain phase with `DATASET_SKIP_GAMMA=1`.
- [x] **V4 adapters + backfill hardening landed** (ADR-0012, ADR-0013): deep
      sweeps now use the Infura-only transport (no Alchemy thrash), and
      `ingest:chain --reset-cursor` clears a poisoned cursor through an
      audited code path.
- [ ] **Polygon re-scan (FOUNDER-TRIGGERED — credit-sensitive)**. The first
      sweep died at exit 127 (~block 61.9M, external process death), and that
      checkpoint predates the V4 adapters, so it must be reset rather than
      resumed. ~8M Infura credits ≈ ~3 free-tier days; resumable across days
      at no extra cost. Prevent machine sleep during the run. Procedure and
      the three ways to fit it: `RECOVERY.md` §0.3.
- [ ] **Then** linter → labels → export → REPORT.md, and run the validator
      (next item) BEFORE trusting any number.
- [ ] **Run `pnpm --filter @verdict/data run validate`** (new this session):
      prints the dispute sanity gate, the MOOv2 answer, the questionId join
      rate, and integrity checks; exits nonzero if the gate fails.
- [ ] **Check the sanity gate**: REPORT.md must show disputes Jan–May 2026 in
      the ~1,000+ range once `index-polygon` is `ok`. The build exits 1 with
      a FAIL line if the gate fails while chain indexing is complete — if so,
      STOP and investigate with the founder (per founding brief §4.6). First
      suspects: MOOv2 events missing (see next item), DisputePrice decode,
      requester filter too narrow (compare against a few known disputes on
      polygonscan).
- [ ] **Verify the label pipeline on real disputes**: pick 2–3 publicly known
      2026 disputes (UMA discourse / oracle.uma.xyz list them), confirm each
      is `disputed` in the dataset, and that at least one escalated one has
      `escalated=true`. Document the check in REPORT or a notebook.
- [ ] **Sanity-check the questionId join rate**: fraction of DisputePrice
      events whose derived questionId matches a `markets.question_id`. Should
      be near 100% for post-2024 markets; if low, compare derived ids against
      `QuestionInitialized` questionIDs (both stored in `resolution_events`).

## P0 — resolve the MOOv2 question — ANSWERED 2026-08-23 (ADR-0014)

It was live all along, behind the V4 adapters. Both V4 adapters'
`optimisticOracle()` returns **`0x2C0367a9DB231dDeBd88a94b4f6461a6e47C58B1`**,
not plain OOv2; v3, old NegRisk and umaSportsOracle still return OOv2. The
answer was hidden by an EIP-55 checksum bug in the V4 literals (ADR-0014):
viem rejected them on `readContract` while `getLogs` — which lowercases —
worked, so `resolveManagedOracle()` silently returned null.
- [x] `SELECT DISTINCT resolved_by FROM markets` → found the V4 adapters
      (ADR-0012).
- [x] Called `optimisticOracle()` on every adapter. `resolveManagedOracle()`
      now resolves the managed oracle at runtime, so **`MOOV2_ADDRESS` does
      not need pinning** — leave it unset unless the getter ever breaks.
- [ ] Confirm the `0x2C03…` name tag on Polygonscan and cite it in
      `config.ts` (cosmetic — the address is read from the adapter itself, and
      nothing hardcodes it).
- [ ] Cross-check UMA's whitelist docs page (github UMAprotocol/uma-docs,
      managedoptimisticoraclev2/default-proposer-whitelist.md) — the ~37
      whitelisted proposer addresses are also a fingerprint: if recent
      ProposePrice proposers ⊆ that list, managed mode is de facto active
      even on the OOv2 contract.
- [x] **MOOv2 dispute rate — MEASURED 2026-08-23. Disputes exist; the label
      survives.** Sampled 20 windows x 7,500 blocks across Jan–Aug 2026
      (100 calls, ~25k credits): **23,898 managed-oracle proposals, 27
      disputes = 0.113%**, spread across the whole year, plus 12 plain-OOv2
      disputes and 21 V4 `QuestionReset`/`QuestionManuallyResolved`. So the
      managed oracle suppresses disputes ~26x versus the 2024 OOv2 baseline
      of 2.90% — real suppression, **not** elimination. The earlier "zero
      disputes, signal may be dead" alarm came from one quiet 11-hour August
      window and was wrong. Sample tx hashes are in the session log for
      Polygonscan spot-checks.
- [ ] **Expect the sanity gate to PASS.** Extrapolating the sampled rate over
      Jan 1–Aug 23 2026 (11.48M blocks) gives **~2,070 MOOv2 + ~920 OOv2
      disputes**; for the Jan–May window the gate measures, ~2,600. The gate
      wants ~1,000+. If the full scan comes back far *below* that, it is a
      code problem, not the world — that inversion is now the useful signal.
- [ ] **Add `QuestionReset` / `QuestionManuallyResolved` as label inputs.**
      21 in the sample, tracking disputes closely but not identically (e.g.
      2026-05-19: 3 disputes, 0 resets; 2026-03-11: 8 and 8). They are
      adapter-level, so they survive future oracle migrations — worth having
      as a component that does not depend on UMA's dispute policy.
- [ ] **Plan for 0.1% class imbalance.** ~3,000 positives against ~2.6M
      markets. Evaluate with precision/recall and calibration, never
      accuracy; consider case-control sampling for training.

## P1 — Phase 0 hardening (before anything is shown publicly)

- [ ] **Ancillary-data rules versions**: `QuestionInitialized.args.
      ancillaryDataUtf8` is the canonical listing-time rules text. Parse the
      `q: … res_data: …` format and store as `rules_versions` with
      `source='ancillary_data'`; compare against `gamma_description` v1 —
      this partially de-censors `rules_edited_after_listing` for markets that
      closed before our first crawl (STATUS "risk #3").
- [ ] **Escalation join refinement** (ADR-0008): store each dispute's full
      ancillary hex; match DVM `RequestResolved`/`VoteRevealed` ancillary by
      prefix (DVM ancillary = original + appended cross-chain fields). Fall
      back to time-match only when truncated. Then link `votes.dispute_id`.
- [ ] **price_reversal backfill**: for closed markets, pull
      `/prices-history?market=<clobTokenId>&interval=max` (fixture exists),
      compute mid within 24h of `closedTime` vs settled outcome per §5 of the
      brief. Rate-limit politely; ~1 request per market — consider top-volume
      subset first. Keep it an auxiliary column.
- [ ] **Kalshi ingestion is Phase 3 in PLAN but listed here as a stub
      placeholder** — do not start; just don't delete the venue table's
      generality.
- [ ] **Linter severity calibration data**: REPORT already emits
      P(hit|contested) lift per rule — after the full run, adjust
      `wordlists.json` severities if any rule's lift is inverted (word lists
      are data, no code change needed; note changes in DECISIONS).
- [ ] **REPORT.md examples**: after the full crawl, confirm the canonical
      examples section shows real political/econ markets for
      deadline-no-timezone AND status-verb-gap (demo slice was sports-only
      and showed "(none found)" — unit tests already prove both on 2020/2021
      fixtures).
- [ ] **Backup**: pg_dump cron (or at minimum copy `.pglite/` + exports)
      until the compose volume story is settled.
- [ ] Start the recurring worker (`pnpm --filter @verdict/workers exec tsx
      src/cli/worker.ts`, needs Redis) so open-market rules re-polls and CLOB
      snapshots accumulate — `rules_edited_after_listing` and
      `price_reversal` only gain signal while this runs.

## P2 — Phase 1 (the score; see PLAN §backlog)

- [ ] LLM clause extractor via `packages/llm` (implement the stub's contract:
      Anthropic SDK, zod structured outputs, retries on invalid JSON, cost
      metering, `model_version` stored on every row — schema has
      `rules_clauses.model_version` ready).
- [ ] Baseline risk score: logistic/GBM on linter features (train split only
      — the split lives in `eval/src/verdict_eval/split.py`, listed_at-keyed);
      isotonic calibration on validate; Brier/log-loss per category in /eval.
      **Train on version-1 rules rows** (listing-time view), not latest
      (ADR-0009 explains the two views).
- [ ] Precedent retrieval over contested markets (pgvector — extension ships
      in the compose image; embeddings go through `packages/llm` metering).
- [ ] Public `/calibration` page + daily "riskiest open markets" digest —
      NOTHING is sold before the calibration page is live (non-negotiable).
- [ ] API: `/v1/markets/:id/score` + webhooks; keep the "recommended outcome,
      not a ruling" framing everywhere.

## P3+ — Phase 2/3 pointers (do not start)

Evidence engine (date-filtered retrieval — the `publishedBefore` guard is
already enforced in `packages/retrieval`), snapshotter to MinIO/R2 (compose
service exists, unused), 3+1 model adjudication, bundle renderer + hashing,
retro-adjudication of every escalated dispute since 2024, Stripe billing,
Kalshi + Polymarket US ingestion (rule *edits* + settlement delays are the
contest signal there — no on-chain data), reviewer workflow with COI
attestations, `EvidenceRegistry.sol` deploy to Base (stub exists).

## Known bugs / rough edges (small, real)

- [ ] `chunkTimeInterpolator` rounds via Number() — fine ≤2^53 but add a
      guard for absurd block numbers.
- [ ] Ethereum indexer has not succeeded against PublicNode since the
      InvalidParams-shrink fix (commit 28efb32) — first Infura run will tell;
      if PublicNode still fails, drop it from the ethereum fallback list.
- [ ] `resolveManagedOracle` treats "both adapters answer OOv2" as "no MOOv2"
      — correct today, but revisit with the P0 MOOv2 item.
- [ ] Gamma `closed=true` semantics ("only closed" vs "closed+open") were
      never disambiguated — the two-pass union makes it moot, but a one-line
      check (query a known-open id with closed=true) would settle it.
- [ ] `data/REPORT.md` is committed (useful for the founder now); once full
      runs regenerate it daily, consider gitignoring and publishing instead.
- [ ] api `main.ts` has no graceful shutdown hooks yet.
- [ ] eval package needs Python 3.12 installed before `pytest` can run.

## Standing risks (watch continuously)

1. Escalation-join heuristic can mislabel `escalated` (ADR-0008) — refine
   before any public number.
2. Free-tier RPC terms shift without notice — the backfill layer is
   provider-agnostic on purpose; if Infura's getLogs rule changes, Envio
   HyperSync or one paid Alchemy month are the escape hatches (ask founder —
   money/new dependency).
3. `rules_edited_after_listing` is right-censored for pre-crawl closes —
   ancillary reconstruction (P1) shrinks but doesn't eliminate this; disclose
   in any published methodology.
4. Speed matters more than polish (in-house build threat, PLAN §constraints)
   — the 90-day target is the public calibration page, not infrastructure.
