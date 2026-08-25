# HANDOVER — pipeline session, 2026-08-24 → 25

Read this first. `STATUS.md` has durable state, `TODO.md` the backlog,
`docs/DECISIONS.md` the decisions (ADR-0001..0022). This file is only what those
don't carry: what's running, what broke, and what turned out to be wrong.

## In flight right now

**The Polygon backfill is running on the VPS** (Hetzner CPX22, `~/prema`,
containers prefixed `prema-`). Past block ~82.6M of ~92.6M.

```bash
tail -3 /root/backfill.log
grep -c "chunk indexed" /root/backfill.log
# resume (it is idempotent; no --reset-cursor, no --from-block):
pnpm --filter @verdict/workers exec tsx src/cli/ingest-chain.ts --chain polygon 2>&1 | tee -a /root/backfill.log
```

Use `exec tsx <script>`, never `run … --` — pnpm's `--` forwarding drops the
args on Linux. Full runbook: `docs/DEPLOY.md`.

**When it finishes:**

```bash
DATASET_SKIP_GAMMA=1 pnpm dataset:build   # re-lints at v1.1.0 (~1h) + labels + export
pnpm --filter @verdict/data run validate  # gate: ~2,000–2,600 disputes Jan–May 2026
pnpm --filter @verdict/data run analyze:signal
pnpm --filter @verdict/workers run worker # start it — time-gated, in tmux
```

The gate number is a real prediction from sampled measurement, not a hope. Far
below it means a code fault, not the world.

## What was measured

**The thesis has a first answer: the signal is real and modest.** Two
independent, properly controlled methods agree:

| method | result |
|---|---|
| Blinded human judgement, 170 markets, volume+category matched | **1.46×** (p≈0.075; 1.78× at confidence≥2, p≈0.026) |
| Stratified per-rule lift (Mantel-Haenszel by category) | **0.93–2.02×** |
| Uncontrolled pooled lift | 20.66× — **wrong** |

`vague-source` (2.02×) is the best rule. `hedge-words` fires on 57.3% of the
corpus and carries nothing. **Ambiguity is common (~30% of clean markets),
disputes are rare (~0.1%)** — so text alone cannot be the headline claim;
stakes-conditioning is where the remaining upside is.

Labels computed on partial chain data: 2,615,958 markets, 42,278 contested —
but 42,138 of those are `resolved_na` and only 141 `disputed`.

## Two things I got wrong, and how

**I believed a confounded number.** Pooled lift said `status-verb-gap` was
20.66×; within Politics it is 1.08×. Sports is 1.38M of 2.6M markets and almost
never disputes, so any rule firing more on Politics inherits the gap for free. I
computed tight Wilson intervals on it and treated precision as validity. The
tell was available before I ran anything — the matched blind study already said
1.46×, and I had both numbers without reconciling them. `analyze:signal` now
prints the stratified column beside the pooled one and flags the gap.

**I added error patterns one crash at a time.** Four unclassified errors killed
four multi-hour resumable sweeps in two days (429, ENOTFOUND, viem
TimeoutError, `-32603 service temporarily unavailable`). Each was fixed by
reading a log and guessing the next pattern. The method was the bug: ADR-0021
inverts the default so an unrecognised error costs a chunk, not the job.

## Traps

- **`hit_*` columns are latest-text, not listing-time.** Anything claiming to be
  hindsight-free must join `rules_versions WHERE version_num = 1`. They diverge
  exactly on rules-edited markets, in the flattering direction.
- **`contested` unions two phenomena with opposite volume gradients** (ADR-0020).
  `resolved_na` concentrates in low-volume markets, `disputed` in high-volume.
  Publishing a "contested rate" without saying which component is misleading.
- **`no-na-condition` scores tautologically** against `resolved_na`: it flags
  text that never mentions N/A, and such markets largely cannot void.
- **Gamma `volume` may double-count.** Affects absolute dollar claims, not
  deciles (rank-based). Unresolved — TODO P0.
- **`LINTER_VERSION` is v1.1.0**, so the next linter pass re-lints all 2.6M
  versions. Intended: it populates `template-residue` and
  `announcement-vs-report` for the first time.
- Commit messages go through a file (`git commit -F`) — double quotes inside
  PowerShell here-strings break argument quoting, which cost three retries.

## 2026-08-25 — backfill landed, then the build OOM'd

**Both chains are complete.** Polygon: 9,496,937 events, cursor at head
(92,626,114). Ethereum: 4,141 events + 2,023,767 votes, blocks
18,908,895–25,830,831. Linter: 2,615,958 versions, **5,670,580 hits** at
v1.1.0 (v1.0.0 was 5,183,533 — the two new rules add ~487k).

**The sanity gate passes.** 4,127 disputes total, **1,509 in Jan–May 2026**
against a >1,000 threshold. My pre-run estimate of 2,000–2,600 was inflated:
the sampled *rate* was right (0.18–0.26 per 1k blocks vs 0.233 actual), the
extrapolation off it was not. Oracle split — `moov2 ProposePrice` 1,795,686,
`moov2 Settle` 1,794,972, `ctf_adapter_v4 QuestionInitialized` 1,527,795 —
which is ADR-0014 (the checksum bug) vindicated: those 1.5M V4 rows were the
ones the mis-cased address had been silently hiding.

**Then `dataset:build` aborted with exit 134** (SIGABRT = JS heap OOM), in
`computeLabels`, on a 4 GB box. Cause and fix in ADR-0022. Short version: a
query written when the events table had 56,833 rows was still loading all
1,958,963 `Settle` events — **5,063 MB of `args`**, because MOOv2 settles carry
full ancillaryData — to serve lookups for 4,127 disputes. ADR-0019 streamed the
*market* side of that function and left the event side alone, correctly at the
time; the backfill grew it 167x.

Fixed by bounding each query by the join it feeds rather than the table it
reads: settles fetched by disputed questionId (1,958,963 → 7,095), DVM times
reduced to distinct epochs in SQL instead of pulling ~2M vote rows, payout
vectors prefiltered in SQL (~86k of 3.4M) with `isFiftyFifty` still deciding,
and the two corpus-wide 2.6M-entry id maps deleted in favour of on-demand
lookups.

**Trap worth knowing:** the event-side loads are the ones that scale with the
backfill, and they were invisible while the chain tables were empty. If a build
step OOMs again, check `sum(pg_column_size(args))` per `event_name` before
anything else — `Settle` is 5 GB, `QuestionResolved` 281 MB, and the row counts
alone do not tell you that.

**Verified before coding, not assumed:** every `DisputePrice`/`Settle` has a
questionId and timestamp; payout vectors are exactly three shapes, and the
86,234 `["1","1"]` rows are all of on-chain `resolved_na`.

**Second quoting trap, after the `git commit -F` one:** shell scripts destined
for the VPS must be written with a heredoc, not the editor — the Write tool
emits a UTF-8 BOM and CRLF, and bash answers with
`` `$'do'` `` syntax errors. Same failure family as the `Set-Content -Encoding
utf8` BOM that broke `package.json`. And when passing a command through
PowerShell to `ssh`, `$(...)` and `|` are interpreted by PowerShell first; pipe
the script over stdin (`Get-Content x.sh | ssh host "bash -s"`) instead of
escaping through two layers.

### How to check / resume the running build

    ssh root@167.233.166.121
    tmux attach -t backfill3          # detach with ctrl-b then d
    tail -f ~/build-2026-08-25.log

It is running with `DATASET_SKIP_GAMMA=1 DATASET_SKIP_CHAIN=1`, since both
stages are already at head — that skips ~2h of no-op re-ingest. **A later run
should drop those flags** to pick up markets closed since 2026-08-24; a partial
gamma pass was interrupted mid-way (~21k markets upserted), so the venue side is
one day stale and slightly ragged, which is fine for labels but should be
completed before any published number.

## The gating question, answered: no

`ROADMAP-next-sessions.md` said everything downstream depended on whether
`vague-source`'s **2.02x** stratified lift survived at ~21x more positives.
Full corpus, 2,615,958 markets labelled, 44,726 contested (1.71%), 2,089
disputed:

    §4 disputed alone, by-category (Mantel-Haenszel — the column to trust)
      vague-source        1.57x    (was 2.02x)
      status-verb-gap     1.40x    (pooled 7.41x, flagged composition)
      hedge-words         1.27x
      no-na-condition     1.09x
      deadline-no-tz      0.35x
      occurrence-vs-rep   0.00x    (1,974 fires, zero disputes)

    §3 top volume decile, by-category
      hedge-words         2.40x    vague-source 1.61x    status-verb-gap 1.50x

**It did not hold.** 1.57x corpus-wide, 1.61x in the top decile. Directionally
positive, materially weaker, and consistent with every other measurement we
have — the blind study's matched 1.46x most of all. Three independent methods
now agree the text signal is real and modest. That is the finding; it should
stop being re-litigated each session.

Two rules of seven carry nothing: `occurrence-vs-reporting` (1,974 fires, zero
disputes, zero contested) and `outcomes-not-exhaustive` (structurally
unreachable, ADR pending). `hedge-words` fires on 1,498,344 markets — 57% of the
corpus — so its 1.27x cannot rank a watchlist even though it is positive.

**Then stakes turned out to be the real signal — see ADR-0023.** Given the same
Mantel-Haenszel treatment as the rules, the top volume decile runs **6.45x**
against `disputed` (532 strata, pooled 9.51x), holding inside every large
category. `disputed` climbs monotonically 0.020% -> 0.514% across deciles, a
25.7x spread. **Stakes is about 4x the predictor text is.**

Finding that required fixing a defect that had been quietly shaping every decile
table we produced: 803,398 markets (30.7%) have no volume, and `nulls first`
swept them whole into deciles 1-3. The old "contested falls 4.13% -> 0.73% as
stakes rise" was mostly that artifact. Separated out, the volume-less bucket runs
4.030% contested but 0.034% disputed — voided constantly, disputed normally,
exactly what a market that never traded looks like — and **`contested` turns out
to have no volume gradient at all** (0.55-0.77% flat across d3-d10). ADR-0020's
"opposite gradients" should be read as: disputed rises steeply, contested is
flat. `contested` is 95.5% `resolved_na` (was ~99.7% pre-backfill; the analysis
computes and prints this now rather than hardcoding it).

**The constraint that decides what this is worth:** `volume_usd` is *final*
volume, unknown at listing time. Ranking listings by it is hindsight and breaks
ADR-0009. It is valid as a description of where disputes concentrate, and valid
as a *running* feature — volume-to-date on a live market — which means it
supports a watchlist that re-ranks live markets, not a score-at-listing product.
`analyze:signal` prints that caveat beside the number so it cannot be quoted
bare.

### Two numbers that need reading carefully

**`escalated` is 6 markets.** Not a bug and not my refactor: SQL confirms
exactly 6 dispute timestamps match a DVM vote time, and there are only 3,359
distinct vote request times across 2,023,767 vote rows. So `escalated`
contributes ~nothing to `contested`, and `rules_edited_after_listing`
contributes zero until the worker has run for weeks. **The composite label is
currently just `resolved_na OR disputed`.** Worth deciding whether the ADR-0008
timestamp join is the right mechanism at all — in UMA OOv2 a disputed request
normally *does* reach the DVM, so 6/4,127 suggests either MOOv2 resolves
disputes off the DVM path or the join is wrong.

**38% of disputes never reach a market, and not at random.** 1,561 of 4,127
dispute events have a questionId matching no market (62.2%;
`QuestionInitialized` is 69.8%). The loss clusters by oracle — `moov2` matches
**77.9%**, `oov2` only **41.4%** — while by year it is nearly flat (58.6 / 57.6
/ 65.2), so it is an oracle effect, not an era one.

That matters for the number above: the 2,089 disputed markets over-represent the
MOOv2 regime along exactly the dimension known to shift the dispute rate 8.4x,
so §4's 1.57x rests on a non-random subsample. It does not overturn the 1.4–1.6x
consensus — three methods agree — but the figure should carry the caveat, and
fixing the join could move it either way. Now the highest-value item in
`TODO.md`; start from the OOv2 gap rather than assuming a corpus-wide
derivation bug.

## Late session: worker started, neg-risk join fixed, regime trend measured

**Recurring worker is live under systemd**, not tmux — `/var/run/reboot-required`
was already set, so an unattended-upgrades reboot would have killed a tmux
worker silently, and this needs to run for weeks. `systemctl status prema-worker`;
logs at `/var/log/prema-worker.log` (weekly logrotate). Compose services now
carry `restart: unless-stopped` — they had **no** restart policy, so after that
reboot the database would not have come back and the worker would have
crash-looped against nothing. First run stored 172/200 CLOB snapshots; the 28
misses are 404s on books that closed between the Gamma poll and the fetch, which
is expected. **Correction to what I told the founder earlier: this worker costs
no RPC credits** — both jobs hit Polymarket's public Gamma/CLOB APIs.

**The 38% dispute-orphan rate is fixed — ADR-0024.** Not a derivation bug: the
orphans' question ids *are* in `QuestionInitialized`, and a control proved
`keccak256(ancillaryData)` reproduces CTF condition ids 500/500. The join rate
splits by adapter — the three CTF adapters reach a market 95-98% of the time,
both neg-risk adapters **0.0%** across 599,803 questions. Neg-risk adapters mint
their own question ids, emit no conditionId, and prepare the CTF condition in a
*different transaction* than the one initialising the question. The bridge was
already in our database: Gamma's `negRiskRequestId` is exactly the on-chain
neg-risk question id, **505,554/505,554**. Live result: orphans **1,561 → 235**,
disputes with a market **2,566 → 3,892**.

**Two process notes worth keeping.** The first derivation probe used `abi.encode`
where CTF uses `abi.encodePacked` — a plausible hash matching nothing, caught
only because the probe carried a control that was *supposed* to match. Always
give an id-scheme probe a control. And I nearly started a full Polygon re-scan to
index `ConditionPreparation` (about a day) when the answer was one query away in
a column we already had — check what the venue API already gave us before
reaching for the chain.

**The regime break is worse than the brief says.** Monthly series measured
2026-08-25: MOOv2's dispute rate is not a step down to a plateau but a
**continuing decline** — 0.263% (Sep 2025) → 0.068% (Aug 2026) — while proposal
volume grew **35x** (13,711 → 477,060/month). OOv2 is now vestigial (1,140
proposals in Aug 2026). Like-for-like the collapse is nearer **20x** than the
pooled 8.4x, because that pooled figure averages a high-early period against a
low-recent one. The 2025-09-05 enforcement date is **confirmed** by our data (11
MOOv2 proposals in Aug 2025, 13,711 in Sep). `docs/BRIEF-product-evolution.md`
carries the table.

This matters strategically: the phenomenon the company measures is shrinking on
a *trend*, not a step, which is the top kill-risk in `WHERETOGO.md`. The monthly
MOOv2 dispute rate is the early-warning metric to watch.

## Shipped

Linter: `template-residue` (9.26% fire rate), `announcement-vs-report` (0.006%,
catches the Strategy market), `outcomes-not-exhaustive` diagnosed as unreachable
and kept. Pipeline: everything streams now (ADR-0019) — the old shape needed
~5 GB and would have died at the end of the longest job. Chain: NUL stripping,
120s timeout, inverted retry default. Data: `analyze:signal`, the blinded study
harness, `site-export` (disputes.json + canonical `contentHash`, 5,000 records,
audit chain intact).

## Next session, in order

1. Finish the backfill → `dataset:build` → `validate` → check the gate.
2. **Re-run `analyze:signal` at ~15× more positives.** Whether 2.02× survives is
   the question everything else depends on.
3. Start the recurring worker. It is one command and purely time-gated —
   `rules_edited_after_listing` and `price_reversal` stay at zero until it has
   been running for weeks, and that time cannot be backfilled.
4. Then linter v1.1 reweighting, which needs the lift data from (2).

Deferred deliberately: the Phase-1 extractor until (2) says what to aim at, and
a public linter-v1 watchlist, which would rank noise.
