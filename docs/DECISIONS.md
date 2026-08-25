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

---

## ADR-0013 — Deep backfill runs on the primary transport only (2026-08-23)

**Decision:** `makeClient(chain, { primaryOnly: true })` builds a client from
the primary (Infura) URL alone, with no viem `fallback()` transport, and both
`indexPolygon` and `indexEthereum` use it. The fallback chain stays the default
for every other caller — live head-tailing works in small ranges the secondary
can serve. Alongside it, `resetChainCursor(db, chain)` (surfaced as
`ingest-chain --reset-cursor`) clears a `chain:<chain>:lastBlock` row through
an audited code path instead of a hand DB edit.
**Alternatives:** keep `fallback()` everywhere — rejected: the first full
backfill's logs show repeated thrash against Alchemy ("JSON is not a valid
request object"), because Alchemy's free tier caps `eth_getLogs` at ~10 blocks
(ADR-0002) and simply cannot answer the deep ranges the sweep issues. Every
failover was a guaranteed-failed request plus retries — wasted wall-clock and
credits, and noise that hid real range errors. Also considered: teaching
`forEachAdaptiveRange` to detect and quarantine an unusable provider
(more moving parts than declaring transport intent at the call site).
**Why the cursor reset is code, not SQL:** the stored Polygon checkpoint
(~block 61.9M) predates the V4 adapters (ADR-0012), so resuming from it would
silently skip all V4 history below it — a full re-scan is required. Events
dedupe on `(chain, tx_hash, log_index)`, so re-scanning seen blocks is a safe
no-op. `ingest_state` is operational bookkeeping and may be deleted (unlike
decision-relevant rows), but the deletion appends to `audit_log` so the reset
is on the record.
**Not done here:** combining the three OO `getLogs` calls into one via manual
topic encoding (~40% fewer calls). It needs hand-built topic arrays and mainnet
verification; a wrong encoding would silently drop events. Tracked as
RECOVERY.md §0.3(b).

---

## ADR-0014 — Store addresses EIP-55 checksummed; MOOv2 found behind V4 (2026-08-23)

**Decision:** every address literal in `chain/config.ts` is stored in canonical
EIP-55 checksummed form, pinned by a test over `POLYGON_CONTRACTS` +
`ETHEREUM_CONTRACTS`. `MOOV2_ADDRESS` stays unset: the managed oracle is
resolved at runtime from the adapters themselves.
**The bug:** the V4 literals added in ADR-0012 (and `umaSportsOracle`) were
transcribed with the wrong letter-casing, so their EIP-55 checksum was invalid.
viem validates checksums on mixed-case addresses and throws
`Address "0x65070be9…" is invalid`. This failed **asymmetrically**, which is
why it survived review: `getLogs` lowercases the adapter list first
(`ADAPTER_ADDRESSES.map(a => a.toLowerCase())`) and kept working perfectly,
while every `readContract` against the same address threw. The only
`readContract` we make is `optimisticOracle()` — so `resolveManagedOracle()`
caught the throw, logged a warning, and returned `null`.
**What that cost:** with `managedOracle: null` the indexer queried plain OOv2
only. A 20k-block probe (blocks 92,511,300–92,531,300) captured 17,699 V4
adapter events and **zero** OO events. After the casing fix the same window
yields 8,430 `ProposePrice` + 6,881 `Settle` on the managed oracle. Since the
V4 adapters resolve ~72% of the corpus, the full backfill would have recorded
no proposals, no settlements and **no disputes** for ~1.88M markets — the
composite label's primary signal, silently empty.
**MOOv2, answered:** both V4 adapters return
`0x2C0367a9DB231dDeBd88a94b4f6461a6e47C58B1` from `optimisticOracle()`;
`ctfAdapterV3`, the old NegRisk adapter and `umaSportsOracle` all still return
plain OOv2. This supersedes the STATUS.md finding that MOOv2 appeared not to be
live — it is live, behind the adapter generation we hadn't enumerated. The
address appears in no UMA doc or repo (STATUS.md); we read it off-chain from
the adapter's public immutable, which is a stronger source than documentation
and needs no hardcoding.
**Alternatives:** lowercase every literal (viem accepts all-lowercase and skips
the checksum) — rejected: checksummed addresses are the reviewable form, and
lowercasing would delete the very error-detection that EIP-55 exists for.
Pinning `MOOV2_ADDRESS` in `.env` — rejected: the runtime getter is
self-updating and already correct; an env pin would go stale on the next
adapter generation, which is exactly how this was missed.
**Lesson (extends ADR-0012):** the earlier lesson was "verify contracts against
on-chain reality, not docs". The sharper version: a config value can be wrong
in a way that only breaks *one* of its uses. `resolveManagedOracle()` degraded
to `null` on error rather than failing loudly, so a silent warning was the only
symptom. Prefer loud failure for facts the dataset's correctness depends on.

---

## ADR-0015 — Backfill sweep tuning: body cap, span floor, learned ceiling (2026-08-23)

**Context:** instrumenting the 2026-08-23 probe showed the sweep was paying for
requests that could not succeed. Three separate causes, all measured, none of
them the provider being stingy.

**1. viem's response cap was binding before Infura's.** `http()` defaults
`maxResponseBodySize` to 10 MiB. At the measured ~1.3 KB/log, that caps a chunk
at ~8k logs — *below* Infura's 10k-log allowance (ADR-0002), so the sweep kept
halving for a client-side reason and never used the range we chose Infura for.
Backfill clients now pass `BACKFILL_MAX_RESPONSE_BYTES` (64 MiB), which puts
the provider's contract back in charge with headroom over a ~13 MiB full
10k-log response, while still bounding a single response's allocation.
*Alternative:* `maxResponseBodySize: false` — rejected, unbounded allocation on
a pathological response is not worth the marginal range.

**2. `INITIAL_SPAN` was ~12x too wide for Polygon.** 50,000 blocks burned four
failed halvings (50k→25k→12.5k→6.25k) before the first success at ~3k. Polygon
opens at 4,000 now; Ethereum's VotingV2 traffic is genuinely sparse and still
opens at 50,000. `MAX_SPAN` is now passed explicitly (400,000, unchanged in
effect) because `forEachAdaptiveRange` otherwise derives it as `initialSpan*8`
— lowering the floor would silently have cut the ceiling to 32,000 and made
the sparse 2024 ranges *more* expensive, which is the opposite of the goal.

**3. Growth was multiplicative in both directions, so failures repeated.**
Every success grew the span 1.5x until the next failure, meaning the loop
rediscovered a known-bad span roughly every third chunk. `forEachAdaptiveRange`
now remembers `ceiling` (the smallest span seen to overflow) and caps growth at
`ceiling * 7/8`, relaxing the ceiling 25% after 16 clean chunks so the sweep
still widens when it crosses into quieter ranges. Simulated against a fixed
capacity: ~1 failed probe per 9 chunks, down from ~1 per 3, with identical
coverage. *Alternative:* a hard learned ceiling with no relaxation — rejected,
event density varies by orders of magnitude across the backfill and a ceiling
learned in a dense range would pin the sweep narrow for the sparse 90%.

**Not done, still:** combining the three OO `getLogs` into one via manual topic
encoding (RECOVERY.md §0.3(b)). Unchanged reasoning — a wrong encoding silently
drops events, and it needs mainnet verification before it can be trusted.
**Honesty note:** these are estimates from one 20k-block probe in the densest
part of the chain. The real sweep spans 40M blocks of wildly varying density;
treat the projected savings as a direction, not a number.

---

## ADR-0016 — Rate limits are not range errors; Infura caps getLogs at 10k blocks (2026-08-23)

**Decision:** `forEachAdaptiveRange` classifies a rate limit separately from a
range error: on 429 it waits (2s, doubling, 8 attempts) and retries the *same*
span; only genuine range/size errors shrink the span. `MAX_SPAN` drops to
10,000 blocks on both chains.

**The bug.** viem surfaces an HTTP 429 as the generic `HTTP request failed`,
which matched `request failed` in the shrink pattern. So the sweep answered
throttling by halving the span — which multiplies the request count, which
deepens the throttling. Observed live against Infura on 2026-08-23 as a death
spiral: 2929 → 2196 → 1921 → 1681 → 1470 → 1102 → 482 → 361 → 270 → 135 → 128
blocks, then hard failure. The shrink pattern was also narrowed (dropping the
catch-all `request failed`) because with ADR-0015's learned `ceiling`, a
transient network error would otherwise poison the ceiling for the whole run —
the new memory made the old over-broad matching more dangerous than it was.

**The measurement that corrects ADR-0002.** ADR-0002 recorded Infura as
accepting *any* block range so long as the response stays under 10k logs. That
is wrong. A deliberately near-empty query — one event signature, one address,
single-digit results — still returned InvalidParams at 15,625 blocks and
succeeded at 7,812. The block-range cap applies regardless of result size, and
10,000 is the evident limit.

**Cost consequence — this supersedes the revision in RECOVERY.md 0.3.** The cap
puts a floor under the sweep that no tuning removes: 40.7M blocks ÷ 10k = ~4,070
chunks minimum, × 5 getLogs = ~20,350 calls ≈ **~5.2M credits ≈ ~2 free-tier
days**. My earlier revision to "~1.3M credits, inside one free day" assumed
400k-block chunks the provider will not serve, and was wrong; the original
~8M/3-day estimate was closer. ADR-0015's tunings still hold — they reduce
wasted probes and let dense ranges use the full 10k — but they cannot beat the
floor. `MAX_SPAN` above 10,000 is unreachable and only wastes the probe.

**Lesson:** two failures that look alike in the log ("the request failed") can
require opposite responses. Retry classification deserves the same scrutiny as
the happy path, and a provider's documented limits are worth measuring — this
one had been carried on trust since ADR-0002 and was load-bearing for every
cost estimate we have made.

---

## ADR-0017 — The managed-oracle dispute collapse is real; keep `disputed` (2026-08-23)

**Decision:** keep `disputed` in the composite label, keep the
`requester`-filtered OO query as-is, and treat the measured post-migration
dispute rate as ground truth rather than a symptom.

**Why this was in doubt.** An 11-hour probe found 8,430 managed-oracle
proposals and zero `DisputePrice`, which looked like the label's primary signal
had been engineered out from under us. It had not. Sampling 20 windows across
Jan–Aug 2026 found **27 disputes in 23,898 proposals = 0.113%**, against a
2.90% plain-OOv2 baseline from 2024 — a ~26x collapse, not an elimination.
August was simply a quiet window, and a single zero-count sample was too thin
to extrapolate from.

**Confirmed externally** (`moo-research.md`, this repo): the address is UMA's
ManagedOptimisticOracleV2 per UMIP-189; `DisputePrice` keeps the identical OOv2
signature; disputing stays permissionless (only *proposing* is whitelisted);
and UMA published the effect — disputes down 68% in the first month after
proposer-whitelist enforcement began **2025-09-05**. Our independently measured
rate reproduces press figures for 2026 disputed-market counts once NegRisk
bursts are deduped to distinct markets.

**Consequences.**
- The sanity gate (~1,000+ disputes Jan–May 2026) should **pass**: two
  independent measurements — a spread sample (0.18/1k blocks) and a dense
  June 1–8 sweep (0.191/1k blocks) — extrapolate to ~2,000–2,600. A result far
  *below* the gate now indicates a code fault, not a changed world.
- **No OOReporter blind spot today.** Every requester on both `ProposePrice`
  and `DisputePrice` across 2026 is one of the two V4 adapters we index. Since
  OOReporter is reportedly rolling out, re-check before each backfill.
- **Class imbalance replaces scarcity as the modelling problem:** ~3,000
  positives against 2.6M markets. Evaluate on precision/recall and calibration.
- **A regime break sits inside the training window.** Enforcement began
  2025-09-05; `/eval` trains on ≤2025-12-31 and validates on 2026. The label's
  base rate differs by ~26x across that boundary, so the split must handle it
  deliberately rather than by accident.

**Lesson:** a zero is a measurement, not a conclusion. The cost of checking was
~25k credits and a few minutes; the cost of believing it would have been
re-architecting the label around a problem that does not exist.

---

## ADR-0020 — `contested` unions two phenomena with opposite drivers (2026-08-24)

**Finding, not yet a decision.** Recorded because it was invisible until real
labels existed and it changes what `/eval` and the score can honestly claim.

With 2,615,958 markets labelled (42,278 contested, 141 disputed), the composite
`contested = disputed ∨ escalated ∨ resolved_na ∨ rules_edited` behaves as two
different things stitched together:

| | `resolved_na` | `disputed` |
|---|---|---|
| share of `contested` today | ~99.7% | ~0.3% |
| volume gradient | **concentrates in LOW volume** (d1 4.0%, d10 0.375%) | concentrates in high volume (press: April's disputed contracts carried >$1B) |
| meaning | the question was unanswerable, so it voided | someone paid a bond to challenge an answer |

**The gradients run in opposite directions.** Unioning them means the composite
partly cancels itself, and a model trained on it learns a mixture of two
phenomena with different drivers — while a stakes-conditioned view of the union
is close to meaningless.

**It also breaks specific rules tautologically.** `no-na-condition` flags rules
text that never mentions N/A; the label is *resolved N/A*. Markets whose rules
do not contemplate voiding largely cannot void, so the rule scored 0.00x lift
against `contested` — a definitional relationship presented as a prediction.
The same confound inflated `hedge-words` to 28.81x, which collapsed to 1.14x
once measured against `disputed` and stratified.

**Consequences to decide (not decided here):**
- Model `disputed` and `resolved_na` as **separate targets** rather than one, or
  keep the union only as a coarse "something went wrong" flag.
- The Phase-1 score almost certainly wants `disputed`: it is the failure mode
  with money attached and the one the product narrative is about.
- Anything published about "contested rate" must say which component it means.
  The corpus-wide 1.6% is overwhelmingly voiding, not disputes.

**Why this was not visible earlier:** the composite is defensible on paper —
all four components are ways a resolution goes wrong. Only the measured volume
gradients showed that two of them are driven by opposite forces. This is an
argument for computing labels early on partial data, which cost nothing here
and would have surfaced it before the label shaped `/eval`.

---

## ADR-0018 — One getLogs for all three OO events via manual topics (2026-08-23)

**Decision:** the OO query in `indexPolygon` issues a single `eth_getLogs` with
hand-built topics — `topic0 ∈ {ProposePrice, DisputePrice, Settle}` and
`topic1 ∈ adapters` — instead of three separate viem `getLogs` calls. Chunk
cost drops from 5 calls to 3, about **40% fewer credits**, which given
ADR-0016's 10k-block floor is the difference between a ~2-day and a ~1-day
backfill. Deferred since RECOVERY §0.3(b); implemented now that the floor makes
it worth the risk.

**Why it needs raw JSON-RPC.** viem's `getLogs` cannot express "any of these
events AND this indexed argument". Passing `events` (plural) makes it drop
`args` outright — `args: events_ ? undefined : args` in its source — so the
filter silently *widens* to every event on the contract instead of erroring.
That is the trap the deferral warned about, and it fails in the direction that
looks like success. Hence `getLogsByTopics()` at the JSON-RPC level, where both
topic positions can be OR-sets.

**Why one call is sound.** `requester` is the first indexed parameter on all
three events, so it always occupies topic1 and one OR-set filters all of them
identically. This is an invariant of the ABI, not of our code, so `chain.test.ts`
asserts it directly: if an event is ever added whose first indexed argument is
something else, the test fails rather than the sweep quietly missing rows.

**Verification — the part that mattered.** The failure mode is returning
*fewer* logs, which no unit test can detect. Both forms were run over three
real ranges and their result sets compared by
`(txHash, logIndex, eventName)`:

| range | old (3 calls) | new (1 call) |
|---|---|---|
| 87,733,000–87,743,000 (June dispute cluster) | 2,064 | 2,064 |
| 92,520,000–92,527,500 (dense, recent) | 5,128 | 5,128 |
| 81,053,171–81,060,982 (early 2026) | 1,124 | 1,124 |

Identical sets on all three — 8,316 logs including the rare `DisputePrice`
(18 and 3 respectively), which is the class most at risk from a bad filter.
Decode failures are logged at `error` rather than skipped: these logs were
selected by our own topic0 list, so a failure means the ABI and the selector
disagree, which must never pass silently.

**Also here:** `runLinterOverRules` was rewritten to stream by keyset over
`rules_versions.id` with bulk inserts. The previous select-everything,
insert-per-hit shape was fine for the 6k demo slice and would have needed ~5 GB
of heap and ~13M round trips against the real 2.6M-version corpus — it would
have died on first contact with production data. Same signature, so
`dataset:build` is unaffected.

---

## ADR-0019 — The whole pipeline streams; nothing loads the corpus (2026-08-23)

**Decision:** every stage that touches all markets now works on bounded
batches — the linter (ADR-0018), the label job, and the export. `exportAll`
returns an accumulated `ExportSummary` instead of the row array, and
`generateReport` consumes that.

**Why, and why it was urgent.** Fixing the linter revealed the same shape in
the two stages that run *after* it, both of them after a ~1-day backfill:

- `assembleMarketRows` selected every market (all columns), every label, every
  rules version and every linter hit into memory, then returned 2.6M assembled
  rows — roughly 4 GB against Node's ~4 GB default heap.
- `writeCsv` built one string per row plus a single joined string for the file:
  ~2 GB of transient allocation on top.
- `rules_versions.csv` selected whole rows — ~2.6 GB of rules text — purely to
  call `.length`. Now `length(rules_text)` in SQL.
- `computeLabels` held 2.6M market rows *and* two derived id maps at once, and
  resolved price-reversal markets with `marketRows.find()` **inside a loop** —
  O(metrics x 2.6M).

All of it was sized for the 6k demo slice and correct there. The failure would
have landed at the end of the longest job we run, which is the worst place to
discover it: the chain data survives in Postgres, but the export and REPORT.md
do not.

**Consequence for the report:** every figure it prints is an accumulation, so
the summary loses nothing — counts, volumes, by-month, by-category,
by-mechanism, per-rule lift, and top-3 examples per rule are all accumulated in
one pass. Where the old code re-scanned the rows for examples, a running top-N
now does the same job.

**Added while here, from the website session's `EXPORTER-GAPS.md`:**
`volume_decile`, `venue_id`, `closed_time`, `outcomes`, `outcome_prices`,
`label_computed_at`. Deciles come from nine `percentile_cont` cuts computed once
rather than `ntile(10)`, which would need the corpus ranked in a single pass;
the split is the same and it survives batching. **A null volume yields a null
decile** — "unknown stakes" and "lowest stakes" are different claims. REPORT.md
now prints contested rate by decile, because a rate averaged over a corpus that
is mostly trivial markets is true and nearly useless: disputes concentrate in
high-stakes markets.

**Also:** `rowsOf()` normalizes `db.execute()` results, because postgres.js
returns an array and PGlite returns `{ rows }`, and both are supported
(ADR-0003). And the `hit_*` columns now carry a comment at the point of
computation saying they are a *latest-text* view: anything claiming to be
hindsight-free (ADR-0009) must join `linter_hits` to
`rules_versions WHERE version_num = 1` instead. The two diverge precisely on
rules-edited markets, in the direction that flatters us — caught by the website
session before it reached a page.

---

## ADR-0022 — Fetch what the join needs, not the table it lives in

**Status:** accepted · 2026-08-25

`dataset:build` died with `Exit status 134` (SIGABRT, "JavaScript heap out of
memory") after the backfill completed. Not disk — 27 GB free — and not the
linter, which had finished cleanly at 5,670,580 hits. It died in `computeLabels`.

The cause was a query written when the events table held 56,833 rows. It now
holds 9.5M:

```
Settle              1,958,963 rows    5,063 MB of args
QuestionResolved    1,948,815 rows      281 MB
ConditionResolution 1,454,737 rows      413 MB
DisputePrice            4,127 rows       10 MB
```

`Settle` carries the full `ancillaryData` blob, so 5 GB of it was being loaded
into a `Map` on a 4 GB box — to serve lookups for 4,127 disputes. ADR-0019
streamed the *market* side of this function for exactly this reason and left the
event side alone, because at the time the event side was three orders of
magnitude smaller. The backfill changed that by 167x and the query did not move.

**The rule this encodes: bound a query by the join it feeds, not by the table it
reads.** Four loads were rewritten to that shape:

- **Settles** are fetched by the disputed `questionId`s. The request key is
  `sha256(questionId|timestamp)`, so only a settle sharing a dispute's
  questionId can share its key — the rest were never reachable. 1,958,963 rows
  becomes 7,095, a 276x cut, and it is a *superset* of what can match, so the
  narrowing cannot change a label.
- **DVM times** are reduced to distinct epoch seconds in SQL. The old code
  pulled all ~2M `votes` rows to build a `Set` of times, and selected
  `ancillaryHash` alongside without ever reading it.
- **Payout vectors** are prefiltered in SQL to uniform arrays — a superset of
  the 50/50 ones, ~86k of 3.4M. `isFiftyFifty` still makes the final call, so
  the SQL predicate can only ever be too generous, never too strict. This keeps
  one authority for the definition instead of two that can drift.
- **The corpus-wide `byQuestionId`/`byConditionId` maps are gone.** 2.6M entries
  each, built by streaming every market, to answer a few thousand lookups. Ids
  are now resolved on demand in batches, ordered by market id so the same market
  wins a duplicate id as before.

Verified against the live corpus before writing the code rather than assumed:
every `DisputePrice` and `Settle` carries a questionId and timestamp (so the
null-key path is unreachable here, though it is still handled), and the payout
vectors are exactly three shapes — `["0","1"]`, `["1","0"]`, `["1","1"]` — with
the 86,234 `["1","1"]` rows being the whole of on-chain `resolved_na`.

A test pins the narrowing: a settle for an undisputed question sharing a
dispute's timestamp must neither attach to that dispute nor create a row.
