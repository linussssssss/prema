# Decisions (ADR log)

One entry per technical decision not already fixed in `docs/PLAN.md`.
Format: date, decision, alternatives, why. Append-only; supersede with a new
entry rather than editing an old one.

---

## ADR-0001 — Seed docs/PLAN.md from the founding brief (2026-08-22)

**Decision:** No standalone plan document existed, so `docs/PLAN.md` was
written from the founding message (v0) and is now the product source of truth.
**Alternatives:** leave PLAN.md absent until the founder writes one.
**Why:** CLAUDE.md and future sessions need a stable reference; the founding
message would otherwise live only in one chat transcript.

---

## ADR-0002 — RPC providers: Infura primary, Alchemy secondary (2026-08-22)

**Decision:** Chain access via env-configured URLs only (no provider SDKs).
Primary for backfill + serving: Infura/MetaMask Developer Core (free) — 3M
credits/day, `eth_getLogs` = 255 credits, and getLogs accepts either a
2,000-block range with unlimited response or **any** block range capped at 10k
logs returned. Secondary (viem `fallback()` transport + live head-polling):
Alchemy free tier (30M CU/month) — its getLogs is capped at 10 blocks/request
on free, fine for tailing, useless for backfill. Keyless emergency fallback
for recent blocks: PublicNode.
**Alternatives:** Alchemy-only (free getLogs cap 10 blocks → backfill would
cost ~300M CU/month, 10× the allowance); QuickNode free (getLogs cap 5
blocks); dRPC (limits unverifiable from docs at decision time); Envio
HyperSync (fast but niche dependency — revisit if backfill is too slow);
paid plans (ask founder first).
**Why:** verified Aug 2026 that free tiers have clamped getLogs ranges;
Infura's 10k-logs-any-range rule is the only verified free path for a
2024→now Polygon backfill. Backfill layer does adaptive range bisection +
backoff regardless of provider, so switching is a `.env` edit.

---

## ADR-0003 — PGlite for tests and Docker-less demo runs (2026-08-22)

**Decision:** `DATABASE_URL=pglite://<dir>` runs the identical Drizzle schema
on in-process Postgres (PGlite, Apache-2.0). Used by vitest and by dataset
runs on machines without Docker. The real stack stays Postgres 16 + pgvector
via docker compose; migrations are identical for both.
**Alternatives:** testcontainers (needs Docker — not installed on the dev
machine at project start); mocking the DB (tests would lie).
**Why:** lets the full pipeline run and be tested end-to-end today; CI needs
no services.

---

## ADR-0004 — Market identity and dataset lower bound (2026-08-22)

**Decision:** Internal market key = Gamma market `id` (venue-scoped, unique
`(venue_id, external_id)`). "Since 2024-01-01" means markets *created* on or
after 2024-01-01 UTC (Gamma `createdAt`). On-chain rows join via
`condition_id`/`question_id`.
**Alternatives:** key by conditionId (missing for some pre-listing rows); "in
2024+" = resolved after 2024 (would truncate rules-edit history for markets
listed earlier).
**Why:** created-at is the listing-time viewpoint the ambiguity score will
operate at; no hindsight in the cut.

---

## ADR-0005 — dataset:build is a sequential in-process pipeline (2026-08-22)

**Decision:** `pnpm dataset:build` runs ingestion → indexing → labeling →
export as ordered in-process steps (idempotent upserts, resumable). BullMQ is
used only for recurring jobs (hourly CLOB snapshots, open-market rules
re-polls), not for the rebuild.
**Alternatives:** everything through BullMQ queues.
**Why:** determinism and "one command rebuilds the dataset from scratch"
matter more in Phase 0 than throughput; queues add failure modes to a batch
job that doesn't need them.

---

## ADR-0006 — Rules text is normalized before hashing (2026-08-22)

**Decision:** `rules_versions.text_hash` = sha256 of normalized text
(CRLF→LF, trailing whitespace stripped, >2 blank lines collapsed, trimmed).
A new version is appended only when the normalized hash changes.
**Alternatives:** raw-byte hashing.
**Why:** venue-side cosmetic whitespace churn must not count as a rules edit —
it would poison `rules_edited_after_listing`, which feeds the contested label.
The raw text is still stored verbatim.

---

## ADR-0007 — Block timestamps by chunk interpolation (2026-08-22)

**Decision:** `occurred_at` for indexed events is linearly interpolated
between the first/last block timestamps of each getLogs chunk (2 getBlock
calls per chunk) instead of one getBlock per log.
**Alternatives:** exact per-block lookups (thousands of extra RPC calls);
receipts with timestamps (not available).
**Why:** Polygon blocks are ~2s; interpolation error is seconds-to-minutes on
a label whose semantics are day-level. Exact request timestamps, where they
matter (OO request time), come from event args, not block time.

---

## ADR-0008 — Escalation join heuristic, label v1 (2026-08-22)

**Decision:** a dispute counts as `escalated` when its OO request timestamp
appears among DVM `RequestResolved`/`VoteRevealed` request times
(YES_OR_NO_QUERY-filtered). The DVM ancillary keeps the original ancillary as
a prefix, so an ancillary-prefix check is stored for refinement, but v1 joins
on time.
**Alternatives:** exact ancillary matching only (breaks when >16KB truncated);
questionID matching (DVM events don't carry it).
**Why:** request timestamps are block timestamps of `initialize()`; collisions
across two disputed markets in the same second are rare, and false positives
only mildly overstate `escalated` inside an already-contested market. Revisit
in Phase 1 with the full ancillary corpus.

---

## ADR-0009 — Export hit counts use the latest rules version (2026-08-22)

**Decision:** `markets.csv`/`.parquet` linter-hit columns count hits on the
market's *latest* rules version only; per-version hits remain in
`linter_hits.csv`.
**Why:** a market whose rules were edited would otherwise double-count hits;
the listing-time score (Phase 1) will instead train on version 1 rows from
`linter_hits.csv` — both views stay available.

---

## ADR-0010 — Demo/CI run modes (2026-08-22)

**Decision:** `dataset:build` honors env caps: `DATASET_MAX_PAGES`,
`DATASET_MAX_BLOCKS`, `DATASET_NEWEST_FIRST=1` (Gamma id-descending crawl that
stops when a whole page is pre-2024), `DATASET_CHAIN_FROM_RECENT=1` (index
head−maxBlocks..head). Any capped/from-recent run is marked `partial` and
REPORT.md states the dataset is incomplete. Full runs use ascending crawls
from stored cursors and the 2024-01-01 block boundary.
**Why:** the dev machine had no Docker and no RPC keys on day 1; the whole
pipeline still had to run end-to-end on real data without ever pretending the
result is the full dataset.

---

## ADR-0011 — .env loading + bare-key RPC config (2026-08-23)

**Decision:** `loadEnv()` (in `packages/schema`) loads `.env` into
process.env without overriding already-set vars, searching cwd → repo root →
repo parent (the founder's `.env` sits one level above the repo). Every
entrypoint calls it first. RPC env vars accept either a full https:// URL or
a **bare API key**; a bare key is expanded to its slot's provider URL
(primary→Infura, fallback→Alchemy, formats verified 2026-08) via `toRpcUrl()`.
**Alternatives:** the `dotenv` package (extra dep; we have Node's
`util.parseEnv`); requiring full URLs (the founder naturally pasted bare
keys, which the char-length check confirmed match the documented slots);
loading `.env` as an import side effect (less explicit, breaks inline-env
override for tests).
**Why:** nothing loaded `.env` before this (a real gap — the CLIs read
process.env directly); and the ergonomic thing a user does is paste the key,
not assemble the URL. Real shell env still wins so inline `DATABASE_URL=…`
and CI secrets are unaffected.

---

## ADR-0012 — Add V4 CTF adapters after resolver-distribution finding (2026-08-23)

**Decision:** Add `ctfAdapterV4` (`0x65070be9…`) and `negRiskAdapterV4`
(`0x69c47De9…`) to the indexed adapter set, and probe them first in
`resolveManagedOracle()`. Register `umaSportsOracle` (`0xB21182D0…`) for
labeling but **defer** indexing its multi-outcome sports mechanism (it uses a
`MULTIPLE_VALUES` identifier, not `YES_OR_NO_QUERY`; ~5.7k sports markets,
outside the ambiguous-tail focus).
**How it was found:** after the first full Gamma crawl (2.62M markets), the
`markets.resolved_by` distribution showed the two dominant resolvers
(1.48M + 0.40M markets ≈ 72% of the corpus) were **not** the v1/v2/v3 +
old-NegRisk addresses taken from Polymarket's docs — they are newer **V4**
adapters (verified via Polygonscan public name tags). Category breakdown
showed the V4 adapters carry a large share of the ambiguous tail (~15.8k
Politics, plus Midterms/Finance/Culture), so indexing only the old adapters
would have produced a materially incomplete, biased dispute dataset and a
meaningless sanity gate.
**Consequence:** the first Polygon indexing run (only old adapters, ~23%
through blocks, ~28k events) was stopped; chain cursors reset; chain phase
re-run from the 2024 boundary with the full adapter set. Gamma data was
untouched (2.62M markets already committed). resolution_events dedupe on
`(chain, tx_hash, log_index)`, so the partial run's rows are retained, not
duplicated.
**Alternatives:** let the incomplete run finish and note the gap in REPORT.md
(rejected — the founding brief says stop and flag when numbers will be wildly
off); try to enumerate every historical adapter up front (we did, from docs —
the docs were stale, which is exactly why on-chain `resolved_by` is the
ground truth and the linter/verify step caught it).
**Lesson:** verify contract sets against on-chain reality (resolved_by), not
documentation — docs lag deployments.
