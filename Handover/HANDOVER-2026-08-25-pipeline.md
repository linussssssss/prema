# HANDOVER — pipeline session, 2026-08-24 → 25

Read this first. `STATUS.md` has durable state, `TODO.md` the backlog,
`docs/DECISIONS.md` the decisions (ADR-0001..0021). This file is only what those
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
