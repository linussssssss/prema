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
      Cross-check: an independent June 1–8 2026 sweep found 73 `DisputePrice`
      over 381,812 blocks = 0.191/1k blocks, against 0.18/1k from the spread
      sample — the two agree closely, so the extrapolation is sound. And after
      deduping NegRisk bursts to distinct markets it lands near the ~1,150
      disputed markets that press reporting (WSJ, via `moo-research.md`)
      attributes to 2026 — external corroboration that the pipeline is
      measuring the same thing the outside world sees.
- [x] **2024 adapter coverage — CHECKED 2026-08-23, complete.** The website
      session noted UMA publishes a ~1.3% pre-update dispute rate against our
      2.90% 2024 figure, and asked whether an unindexed 2024-era adapter had
      shortened our `ProposePrice` denominator. Sampled 24 windows across the
      2024 sweep's block span, unfiltered by requester: **100% of both
      ProposePrice and DisputePrice requesters are adapters we index**
      (`ctf_adapter_v2`, `neg_risk_adapter`), zero unknown addresses. The
      denominator is not short and the 2.90% baseline stands; the gap to UMA's
      figure is a population difference (their oracle serves more than
      Polymarket), not a measurement error.
- [x] **OOReporter blind spot — CHECKED 2026-08-23, not present.** `moo-research.md`
      finding 6 warned that a newer Polymarket request path (OOReporter,
      audited Aug 2026) could route requests through a different `requester`,
      invisible to our `requester`-filtered OO query. Sampled every
      `ProposePrice` (15,865) and `DisputePrice` requester on MOOV2 across
      2026: **100% are the two indexed V4 adapters**, zero unknown addresses,
      right up to today. Re-check before any future backfill — the research
      says OOReporter is rolling out, so this can change under us.
- [ ] **Count disputed *markets*, not dispute events.** The June 2026 sweep
      found 73 `DisputePrice` in one week, but ~25 of them landed in ~110
      blocks on `neg_risk_adapter_v4` — one multi-outcome NegRisk group
      disputed at once. Dedupe by `question_id` before comparing to any
      external figure or feeding the label.
- [ ] **Mind the Sept 5 2025 regime break in `/eval`.** The proposer-whitelist
      enforcement date (`moo-research.md` finding 5) sits *inside* the training
      window (train ≤ 2025-12-31), while validation is all-2026. So the model
      would train across two dispute regimes — UMA reports disputes fell 68%
      at enforcement — and validate only on the post-migration one. Decide
      deliberately: split at the regime break, weight by era, or restrict
      training to post-Sept-2025. Do not let this happen by accident.
- [ ] **Add `QuestionReset` / `QuestionManuallyResolved` as label inputs.**
      21 in the sample, tracking disputes closely but not identically (e.g.
      2026-05-19: 3 disputes, 0 resets; 2026-03-11: 8 and 8). They are
      adapter-level, so they survive future oracle migrations — worth having
      as a component that does not depend on UMA's dispute policy.
- [ ] **Plan for 0.1% class imbalance.** ~3,000 positives against ~2.6M
      markets. Evaluate with precision/recall and calibration, never
      accuracy; consider case-control sampling for training.

## P0 — linter v1 quality, measured on the full corpus (2026-08-23)

The linter has now run over all **2,615,958 rules versions → 5,183,533 hits**
(0 skipped, exit 0).
These are base rates, not lift — lift needs the labels, which need the chain
backfill. But three things are already actionable and two are uncomfortable.

- [ ] **`outcomes-not-exhaustive` fires ZERO times in 2.6M versions.** Not a
      data bug: `markets.outcomes` is stored as a proper JSON array
      (`["$10", "$20"]`, 2,615,958 rows), so the rule is fed what it expects and
      still never matches. It passes its unit test and does nothing on reality.
      Either fix or retire it — as it stands it is a scored rule contributing
      nothing.
- [ ] **Two rules dominate and carry little information.** Share of corpus
      flagged: `hedge-words` **57.3%** (1,498,344), `no-na-condition` **40.9%**
      (1,070,029), `vague-source` 9.5%, `deadline-no-timezone` 1.0%,
      `status-verb-gap` 0.8%, `occurrence-vs-reporting` **0.1%** (1,974). Only
      281,557 versions (10.8%) have any hit beyond the top two. A rule firing on half the corpus cannot do much
      ranking work against a ~0.1% contested base rate, so a v1 score would be
      driven by its two least discriminating inputs. Confirm with lift once
      labels exist, but plan for reweighting or dropping them.
- [ ] **The linter MISSED the flagship dispute's actual failure mode.** The
      June 2026 Strategy market ("MicroStrategy sells any Bitcoin by May 31,
      2026?", listed 2026-05-05) turned on sale date vs disclosure date — an
      8-K filed June 1 disclosed 32 BTC sold May 26–31. That is
      `occurrence-vs-reporting` exactly, the rule predates the market, and it
      **did not fire**. The market was flagged (`hedge-words`,
      `no-na-condition`, `vague-source`) so it would appear on a watchlist, but
      not for the right reason. This is the single best ground-truth case we
      have (high-profile, expensive, independently adjudicated by a DVM vote) —
      make it a linter fixture and treat it as a regression target for v2.
      Credit: the case was identified by the website session.
- [x] **Strategy market volume — RESOLVED 2026-08-23, not our bug.** Gamma
      itself returns `volume` = `volumeNum` = `volumeClob` =
      **375,813,104.556** for market 2169995, exactly what we stored. Press
      ">$60M" is a lower bound and compatible. The one genuinely open question
      is whether Gamma's lifetime `volume` counts both sides of each trade —
      **but that does not affect `volume_decile`, which is rank-based, so any
      uniform scaling leaves deciles identical.** Stakes-conditioned analysis
      is therefore safe; only absolute dollar claims need the caveat. (Note
      `volume1yr` reads 70.76 on the same market — the windowed fields are not
      interchangeable with lifetime `volume`; don't mix them.)

## P0 — signal validation: does listing-time text carry the signal? (NOW)

The falsification test for the whole thesis. If contested markets' listing-time
text contains visible ambiguity, linter v1 is merely weak and a better
extractor fixes it. If it does not, listing-time scoring has a ceiling no model
raises and the product changes shape. Everything in P1/P2 is downstream of it.

- [x] **Blinded sample built** — `pnpm --filter @verdict/data run blind-study`
      writes `data/blind/ambiguity-study.json` (170 items: 85 contested + 85
      controls matched on listing month, category and volume band) plus
      `key.json`. Deterministic seed, gitignored — rebuildable, and neither the
      answers nor 170 markets' verbatim rules text belong in a public repo
      (SEO.md §4).
- [x] **Judged blind by the website session**, 170/170, pre-registered
      criterion committed before the input existed.
- [x] **Scored 2026-08-24** (`pnpm --filter @verdict/data exec tsx
      src/score-blind-study.ts`). **There is a signal and it is modest.**

      | cut | contested | control | diff | lift |
      |---|---|---|---|---|
      | all items | 47/85 = 55.3% | 27/85 = 31.8% | +23.5pp | 1.74x |
      | **excluding disclosed** | **30/68 = 44.1%** | **25/83 = 30.1%** | **+14.0pp** | **1.46x** |
      | disclosed only | 17/17 = 100% | 2/2 = 100% | 0pp | 1.00x |
      | confidence >=2, ex-disclosed | 21/45 = 46.7% | 17/65 = 26.2% | +20.5pp | 1.78x |

      Two-proportion z-test: ex-disclosed p≈0.075 (marginal); restricted to
      confidence>=2, p≈0.026 (significant). The effect *sharpens* when
      restricted to confident judgements, which is the direction a real signal
      moves.
- [x] **The disclosure exclusion was necessary, and the data proves it.**
      Every disclosed item was judged ambiguous — including both disclosed
      *controls*. So recognition drives the judgement regardless of the true
      label: notability leakage, not label leakage. Scoring on all items
      (1.74x) overstates; 1.46x is the honest figure.

- [ ] **The finding that should drive product design: ambiguity is common,
      disputes are rare.** ~30% of *non-disputed* markets carry visible
      listing-time ambiguity. At a ~0.1% dispute base rate, a perfect binary
      ambiguity screen would flag roughly a third of the corpus to catch under
      half the disputes. **Text ambiguity alone cannot be the headline claim.**
- [ ] **Note what the design deliberately controlled away.** Controls were
      matched on volume band, so this measures text's marginal contribution
      *holding stakes constant*. That is the right question for "does text
      carry signal" but it understates a product combining text with stakes —
      and stakes is the stronger known predictor. Re-run unmatched, and
      conditioned on `volume_decile`, once labels land.
- [ ] **Aim linter v2 / Phase 1 at the discriminating kinds, not at ambiguity
      in general.** Among `yes` judgements (ex-disclosed): `subj` 3 contested /
      0 control, `oth` 4/1, `edge` 11/8, `src` 7/9, `thr` 5/7. Only the first
      two lean contested; `src` and `thr` are near-even and would add noise.
      Small n — treat as a direction, not weights.

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
