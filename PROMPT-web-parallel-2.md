# PROMPT — round 2 for the website agent (2026-08-23)

Paste into the prema-web session. Follows `PROMPT-web-parallel.md`; your
handback (`DATA_CONTRACT.md`, `EXPORTER-GAPS.md`, `HANDBACK-pipeline.md`, and
the draft) was read in full and acted on. Same boundary as before.

---

## Boundary, unchanged

`Desktop/prema/prema-web` only. The pipeline session is now editing
`verdict/data/src/exporters.ts`, `verdict/apps/workers/src/label/compute.ts`,
`verdict/data/src/report.ts` and `docs/DECISIONS.md`. Do not write in
`verdict/`. Nothing was written in `prema-web/` from that side — including the
draft correction below, which is yours to make.

The linter is still writing to `linter_hits`; read-only DB queries are fine.

## Your two catches were right, and one has been verified in the code

**The `hit_*` hindsight trap is real.** Verified at `exporters.ts:91-94` — the
market-level columns do restrict to the latest rules version, and `version_num`
exists for the version-1 join. Wiring them into dispute pages would have made
the no-hindsight claim false on exactly the rules-edited markets those pages
cover. This is a CLAUDE.md non-negotiable and you caught it before it shipped.
A comment is being added at the definition.

**`oracle_mechanism: "mixed"`** — correct, and correctly fixed on your side.

Your `EXPORTER-GAPS.md` §1.1–1.4 asks are being implemented now:
`volume_decile`, `venue_id`, `closed_time`, `outcomes`, `outcome_prices`,
`label_computed_at`. Decisions you handed back, now made:

- **`rules_text`: contested subset only**, as you proposed. Bulk export keeps
  lengths. Your reading of SEO.md §4 is the right one.
- **`site-export.ts` is ours.** The four JSON files will be produced pipeline-side.
- **`venue_url` and the dispute slug stay yours.** Agreed, not building them.

## Task 1 — Correct an arithmetic error in the draft (highest priority)

`docs/drafts/dispute-rate-collapse.md` is careful work and every figure in it
traces back to a real measurement. One inference does not:

> "A rate that falls 26-fold while the denominator grows 23-fold leaves the
> absolute number of disputes approximately flat."

**The time bases do not match.** The 26x rate fall is 2024 → 2026. The 23x
volume growth is *within* 2026 (January to August). They cannot be multiplied
against each other.

Corrected, from the same underlying measurements:

| | 2024 (plain OOv2) | 2026 (managed) | change |
| --- | ---: | ---: | ---: |
| proposals per 1k blocks | 0.673 | 159.3 | **x237** |
| disputes per 1k blocks | 0.0195 | 0.18 | **x9.2** |

Derivation, so you can check rather than trust: the 2024 figures are 6,832
`ProposePrice` and 198 `DisputePrice` over the contiguous block span
51,797,231–61,952,023 (10,154,792 blocks). The 2026 figures are 23,898 and 27
over 150,000 sampled blocks (20 windows x 7,500).

So proposal volume grew ~237x, and **absolute disputes rose roughly 9x** — they
did not stay flat. Note this *strengthens* the piece: a 9x rise in absolute
disputes is what makes "already past the full-2025 total" plausible, and it
supports MARKETING §0.2's "record highs" premise, which "approximately flat"
quietly undercut. The error sits in the very section warning that a hostile
reader checks the arithmetic first.

Two caveats to carry into the text rather than bury:

1. The 2024 population is old-adapter/OOv2 only. That was the entire population
   then — the V4 adapters did not exist — so the comparison is sound. But if
   any 2024 markets resolved through an adapter we never indexed, 2024
   proposals are undercounted and the 2.90% baseline is overstated. We have not
   ruled that out.
2. Both are per-block densities. Polygon block time is near-constant, so
   per-block ≈ per-unit-time, but say so rather than implying per-market.

## Task 2 — Finish your own reviewer checklist

You listed six items at the foot of the draft. Four are research tasks you are
better placed to do than we are:

- Source link for UMA's 68% / 99.7% / 85.8% figures.
- Confirm the Strategy/MicroStrategy market details, volume and date from a
  citable source.
- Confirm and cite the "1,150+ disputed markets in 2026" press claim.
- The checksum anecdote: our view is **keep it**. A methodology note that only
  describes the path that worked is not a methodology note, and the asymmetric
  failure it describes will bite anyone reproducing this. But it is a brand
  call, so put a recommendation to the founder rather than deciding silently.

On your last checklist item — volume-conditioned rates — **hold the draft for
them.** They are the most important cut of this data, you said so yourself, and
publishing the corpus-average rate first invites exactly the "0.1%, so who
cares" reading. `volume_decile` is being added now.

## Task 3 — Extend the contract for the incoming fields

Per your own "Adding a field" process: add each as **optional** first, update
fixtures, render, and only make it required once the pipeline reliably emits
it. Fields: `volumeDecile`, `venueId`, `closedTime`, `outcomes`,
`outcomePrices`, `labelComputedAt`.

`volumeDecile` is an integer 1–10, where **10 is the highest-volume decile**
(`ntile(10) over (order by volume_usd)`). Nulls are possible where volume is
null; the contract should accept that rather than defaulting to a decile, since
"unknown stakes" and "lowest stakes" are different claims.

Worth thinking about how the site *uses* it, not just accepts it: a dispute
rate averaged over 2.6M mostly-trivial markets is a true number that describes
almost nothing anyone trades on. Stakes-conditioned views are likely the
difference between a headline that reads as "99% false alarms" and one a market
maker acts on.

## Task 4 — Specify `content_hash`

You flagged it as "needs a decision on what is hashed before it means
anything", and you are right — a provenance receipt that hashes an unspecified
blob is theatre. You own the page that displays it, so propose the spec: what
bytes go in, in what order, what canonicalisation, and what a reader is meant
to be able to verify with it. We will implement it pipeline-side.

Constraint from CLAUDE.md: anything decision-relevant is append-only and
hashed, and `audit_log` is a hash chain via `appendAudit()` only. If your
proposal can reuse that machinery rather than inventing a parallel one, prefer
it.

## Output

Report back with: the corrected draft, the citations, the contract diff, and
the `content_hash` spec. Flag anything that belongs in `verdict/`.
