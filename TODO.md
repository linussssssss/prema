# TODO — Verdict

Ordered backlog with enough context to execute each item cold. Read
`STATUS.md` first. Conventions in `CLAUDE.md`; scope in `docs/PLAN.md`;
decisions in `docs/DECISIONS.md`. Rules that bind every item: verify external
facts against docs/live responses before coding; append-only for anything
decision-relevant; never fabricate report numbers; record new decisions as
ADRs as you go; `pnpm lint && pnpm typecheck && pnpm test` before "done".

## P0 — unblock the full dataset (founder actions)

- [ ] **Create free RPC keys** (≈10 min, €0):
      Infura/MetaMask Developer Core key at developer.metamask.io (enable
      Polygon PoS + Ethereum mainnet) → `POLYGON_RPC_URL`,
      `ETHEREUM_RPC_URL` in `.env`. Alchemy free key → the two `_FALLBACK`
      URLs. Formats are in `.env.example`. Rationale/limits: ADR-0002.
- [ ] **Install Docker Desktop**, then `docker compose up -d` and switch
      `DATABASE_URL` to the postgres:// form. (PGlite works meanwhile but a
      ~300k-market crawl in PGlite is untested and likely slow.)
- [ ] **Create a GitHub repo and push** — local commits only, no remote yet;
      this machine is currently the only copy of the company. CI activates on
      first push. Do this before anything else — it costs nothing and a disk
      failure right now loses the entire project.

## P0 — first full backfill run (agent-executable once keys exist)

- [ ] **Run the full build**: `pnpm db:migrate && pnpm dataset:build` with NO
      `DATASET_*` caps set. Expectations: Gamma crawl is thousands of pages
      (~0.5–1s each — hours; it resumes from `ingest_state` if interrupted);
      Polygon backfill ~40M blocks from the 2024-01-01 boundary (auto-found by
      block-timestamp bisection) — with Infura's ≤10k-logs-any-range rule the
      adaptive spans should keep this to tens of thousands of requests, well
      inside 3M credits/day; Ethereum is trivial (~7M blocks, sparse).
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

## P0 — resolve the MOOv2 question (dataset correctness depends on it)

Context: the brief says Polymarket moved to Managed OOv2 in late 2025, but on
2026-08-22 both live adapters' `optimisticOracle()` returned plain OOv2 and
live proposals ran through OOv2 (STATUS.md). If MOOv2 IS live somewhere we're
not looking, we under-count disputes exactly where MOOv2 suppresses them.
- [ ] After the full Gamma crawl: `SELECT DISTINCT resolved_by FROM markets`
      — any address beyond the four known adapters is an unenumerated adapter;
      look it up on Polygonscan, add to `chain/config.ts`, re-index.
- [ ] Call `optimisticOracle()` on every distinct adapter found; any address
      ≠ OOv2 is the MOOv2 → pin as `MOOV2_ADDRESS`, write the ADR, re-run
      the OO indexer (state cursors mean only a re-scan of the relevant range
      is needed — delete `chain:polygon:lastBlock` from `ingest_state` for a
      full re-scan, events dedupe on insert).
- [ ] Cross-check UMA's whitelist docs page (github UMAprotocol/uma-docs,
      managedoptimisticoraclev2/default-proposer-whitelist.md) — the ~37
      whitelisted proposer addresses are also a fingerprint: if recent
      ProposePrice proposers ⊆ that list, managed mode is de facto active
      even on the OOv2 contract.

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
