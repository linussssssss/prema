# ROADMAP — next 2–3 sessions (from 2026-08-24)

**Scope: engineering, the next few working sessions.** For the company-level
plan — Phase 0 through the seed round and first venue at months 9–18 — see
[`ROADMAP.md`](ROADMAP.md), which this sits inside. Everything below is
detail on that document's Phase 0 exit gate and the start of its Phase 1.

Written with the backfill running on the VPS. Companion to
`HANDOFF-pipeline-2026-08-24.md` (what happened), `TODO.md` (the itemised
backlog) and `MARKETING.md` (the 90-day commercial sequence).

The organising fact: **we now have one measured number for the thesis — a 1.46x
ambiguity signal at constant stakes — and it was taken at 85 positives.** The
backfill multiplies that by ~13x. Almost everything below either produces that
better number or acts on it, and the plan branches on what it says.

---

## Start this now, whatever else happens

**The re-poll worker is time-gated, not effort-gated.** A one-pass crawl sees
each market once, so `rules_edited_after_listing` — one of four label
components — reads ~0 and will keep reading ~0 until something polls open
markets repeatedly *over calendar time*. Every week it isn't running is a week
of signal that cannot be backfilled later.

It is perhaps a day of work and it should start in session 1, while the VPS
exists, ahead of things that feel more urgent. If the VPS is destroyed after the
backfill, this is the one job that argues for keeping it.

---

## Session 1 — land the dataset, get the real number

**1.1 Finish and validate.** `dataset:build` → `validate` → read `REPORT.md`.
Gate: **~2,000–2,600 disputes for Jan–May 2026**. Materially below that is a
code fault, not the world — debug before believing anything downstream.

**1.2 Index Ethereum.** `resolution_events` holds **zero** Ethereum rows, so
`escalated` has never been populated and the composite label is running on
three of four components. VotingV2 traffic is sparse; this is cheap.

**1.3 The signal analysis at full power** — the session's real deliverable.
With ~1,150 positives instead of 85, compute linter-hit lift three ways:

1. **volume-matched** — comparable to the blind study's 1.46x
2. **unmatched** — text and stakes together, the product-relevant figure
3. **by `volume_decile`** — the cut that decides whether a watchlist is sellable

Expect the corpus-wide dispute rate (~0.1%) to be uninformative and the
top-decile rate to be one to two orders of magnitude higher. If it isn't, that
is the most important negative result the project has produced.

**1.4 Re-score the blind study against real labels.** 170 judgements already
exist; the backfill may reclassify some controls as contested. Cheap, and it
tells us whether a careful human reader beats the linter — the ceiling estimate
for any extractor.

**Done when:** `REPORT.md` carries real numbers, and we know the dispute rate
conditioned on stakes.

**Decision gate:** if lift conditioned on stakes is near 1.0, stop and reshape
the product before writing more scoring code.

---

## Session 2 — fix what the evidence names

**2.1 Linter v1.1.** Three named repairs, all evidence-backed:
- Rebuild `outcomes-not-exhaustive` as **template residue** — outcome labels in
  the rules text that aren't among the market's actual outcomes. Zero hits in
  2.6M today; this is what it was meant to be.
- Rewrite `occurrence-vs-reporting`, with the June 2026 Strategy market as a
  fixture. It fires on 0.1% and missed the case that names its own pattern.
- Add **`guards`** — protective patterns as negative-weight features (stated
  default direction, maximal standards, explicit anchors). Plausibly why
  `hedge-words` at 57.3% shows no discrimination: it can't separate a hedged
  market *with* a default-direction guard from one without.
- Demote or drop the two dominant rules once 1.3 gives real lift figures.

**2.2 Test the template hypothesis.** The blind judge's strongest observation
was that ambiguity is mostly *template misapplication*, not individual
drafting. Testable now: group markets by template family (question-shape
clustering) and compare contested rates within versus across families. If it
holds, v2 targets templates — which have surface forms — rather than prose
ambiguity, which doesn't. **This could matter more than every other linter fix
combined.**

**2.3 `site-export.ts`.** Four JSON files, `rules_text` for the contested
subset only (SEO.md §4), `resolution_events` export, and canonical
`contentHash` bytes per `prema-web/docs/CONTENT-HASH.md`. Unblocks every
dataset-fed page.

**2.4 Settle the `/eval` split.** Whitelist enforcement (2025-09-05) sits
*inside* the training window while validation is all-2026, and the label base
rate differs ~26x across that line. Decide deliberately — split at the regime
break, weight by era, or train post-Sept-2025 only — before any model exists to
be contaminated by it.

**Done when:** linter v1.1 measured against real labels, and the site can be
fed.

---

## Session 3 — Phase 1, aimed rather than guessed

**3.1 LLM clause extractor** (`packages/llm` is a stub with the contract
pinned: zod outputs, cost metering, `model_version` stored with every output).
Target the kinds the study says discriminate — `definition-label mismatch`,
`announcement-vs-report`, `two-stage process` — not ambiguity in general. First
spend on this needs founder sign-off.

**3.2 Calibrated score.** Rare-event discipline throughout: precision/recall
and calibration, never accuracy; case-control sampling for training; publish
the time split beside the numbers.

**3.3 Calibration page.** MARKETING §5's week-12 milestone and the thing that
licenses selling. It needs 3.2, which needs 3.1, which needs session 1's gate.

**Still deliberately not doing:** a public linter-v1 watchlist (MARKETING §5,
weeks 5–8). With `hedge-words` on 57.3% of the corpus it would rank noise in
front of the audience most likely to check. Post-mortems and the methodology
write-up still work for that slot — they render facts rather than predictions.

---

## Carried, unscheduled

- **Volume semantics** — does Gamma's `volume` double-count? Gates absolute
  dollar claims; does not gate deciles (rank-based). The held draft needs it.
- **VPS keep-or-destroy** — hourly billing makes the backfill cost cents, but
  the re-poll worker needs a permanent home. Decide with 1.5.
- **Move `key.json`** out of `data/blind/` before any future blind round.
- **`DEPLOY.md`** still shows `pnpm run … --` in places; the server needs
  `pnpm … exec tsx <script>`.
- **OOReporter recheck** before each backfill — absent today, reportedly rolling
  out.

## What would change this plan

| Finding | Consequence |
|---|---|
| Gate fails (≪1,000 disputes) | Session 1 becomes debugging; everything slips |
| Stakes-conditioned lift ≈ 1.0 | Thesis needs reshaping before any Phase 1 spend |
| Template hypothesis holds | v2 is a template-misapplication detector; rewrite 2.1 around it |
| Top-decile rate ≫ corpus rate | The product is stakes-first with text secondary — sharpen the pitch |
