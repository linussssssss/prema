# PROMPT — parallel work for the website agent (2026-08-23)

Paste into the prema-web session. Written while the Verdict engineering session
is actively editing the `verdict/` repo, so the boundary below is not a
formality — ignoring it will cause merge conflicts in files being changed right
now.

---

## Hard boundary — read first

**Do not edit anything inside `Desktop/prema/verdict/`.** Another session is
mid-flight in that repo: `apps/workers/src/chain/*`, `apps/workers/test/*`,
`data/src/report.ts`, `docs/DECISIONS.md`, `TODO.md`, `STATUS.md` and
`RECOVERY.md` are all live. Read them freely — they are the source of truth —
but write nothing there. If you believe something in `verdict/` must change,
write the request into your own notes and hand it back; do not edit it.
(We already had one near-miss on `STATUS.md` today.)

Your workspace is `Desktop/prema/prema-web` only.

**Also do not touch the database.** A linter job is writing several million
rows to `linter_hits` on the live Postgres. Read-only queries are fine; writes
are not.

## Context you need

Verdict (public name **Prema**) is building a neutral resolution layer for
prediction markets. `verdict/MARKETING.md` is the source of truth for
positioning — read it before writing a word of copy. Two doctrines from it
govern everything below: **"render, don't write"** (every artifact must be
regenerable from the dataset, not hand-authored opinion) and **court reporter,
not take merchant**.

The dataset is ~2 days from existing. Until it does: **no accuracy numbers, no
calibration claims, no score examples presented as real output.** That rule is
absolute and it is what the brand is made of.

## Task 1 — Draft the technical write-up (do not publish)

Today's engineering session produced genuinely original findings that nobody
else has published. `MARKETING.md` §3 calls for a methodology write-up as part
of the launch splash; this is the raw material. Draft it as a Markdown document
in `prema-web` (not a live page yet) so the founder can review.

**Verified facts you may use** (all measured directly on-chain or in our
database on 2026-08-23; do not re-derive, do not embellish):

- Polymarket's current V4 CTF adapters resolve ~1.88M of 2.62M markets, and
  postdate Polymarket's public docs. They were found from the `resolved_by`
  distribution, not from documentation.
- Both V4 adapters route to UMA's **ManagedOptimisticOracleV2** at
  `0x2C0367a9DB231dDeBd88a94b4f6461a6e47C58B1` (UMIP-189). Older adapters
  still use plain OptimisticOracleV2.
- **The dispute rate collapsed ~26x.** Sampled 20 windows across Jan–Aug 2026:
  27 disputes in 23,898 managed-oracle proposals = **0.113%**. The 2024
  plain-OOv2 baseline from our own data is 198 in 6,832 = **2.90%**.
- Cause is documented, not speculative: UMA's proposer-whitelist enforcement
  began **2025-09-05**; UMA published that disputes fell 68% in the first month
  and whitelisted proposers are 99.7% accurate vs 85.8% for others.
- An independent June 1–8 2026 sweep found 73 `DisputePrice` events, giving
  0.191 per 1k blocks against 0.18 from the spread sample — two independent
  measurements that agree.

**The nuance that makes this piece good — and whose absence would embarrass
us.** The dispute *rate* collapsed while the dispute *count* rose. Proposal
volume in our sample grew ~23x over 2026 (263 → 6,029 per 7,500 blocks), so
absolute disputes are flat-to-rising — consistent with press reporting of
1,150+ disputed markets in 2026, past the full-2025 total. **Never state the
rate without the count, or vice versa.** A "disputes are exploding" headline
next to a collapsing rate is exactly the sort of thing that costs a
neutrality-branded project its credibility, and it is the first thing a hostile
reader will check.

The honest thesis, which the piece should argue carefully rather than assert:
the whitelist removed proposer *error*; it cannot remove rules *ambiguity*. The
residual disputes are therefore a purer ambiguity signal than the 2.9% era's
were. Evidence: the June 2026 Strategy/MicroStrategy market ($60M+ volume) had
two "No" proposals *both* disputed and escalated to a DVM vote — a whitelisted
professional facing rules that did not determine the answer.

Tone: court reporter. No adjectives doing argumentative work. Every number
attributed to how it was measured, including sample sizes. Where we are
uncertain, say so — the engineering session's own estimate of this rate moved
three times today before it settled, and a write-up that shows its work is
worth more than one that sounds certain.

## Task 2 — Define the data contract the site will consume

Higher-leverage and lower-risk than Task 1. When the dataset lands the site
needs to render it, and right now nothing specifies the interface.

Read `verdict/data/src/exporters.ts` (particularly `MarketExportRow`) and
`verdict/data/src/report.ts`, then specify, in `prema-web`:

1. The JSON shape each page consumes — Dispute Watchlist, Calibration Page,
   dispute post-mortems, market detail. Derive it from what the exporter
   actually produces; do not invent fields.
2. Build the pages against **fixtures matching that shape**, clearly labelled
   as synthetic, so swapping in real data is a file swap and not a rewrite.
3. Write down any field you need that the exporter does not currently produce.
   That list is genuinely valuable to the engineering session — it is much
   cheaper to add a column before the 2-day backfill than after it. Hand it
   back rather than implementing it.

One field to raise now, because it likely matters more than anything else on
the site: **volume decile**. Disputes concentrate violently in high-stakes
markets, so a base rate conditioned on volume is expected to be one to two
orders of magnitude above the corpus average of ~0.1%. Nearly every number the
site will want to show is more meaningful conditioned on stakes than averaged
over 2.6M mostly-trivial markets.

## Output

Report back with: the write-up draft, the data-contract spec, and the list of
missing exporter fields. Flag anything you believe belongs in `verdict/` rather
than doing it yourself.
