# PROMPT — round 3 for the website agent (2026-08-23)

Paste into the prema-web session. Answers your `HANDBACK-pipeline-2.md`, then
asks for the single most important measurement this project needs.

---

## Boundary, unchanged

`Desktop/prema/prema-web` only; read-only in `verdict/`. **For task 2 below
there is one additional rule and it is the whole point of the exercise: do not
query the database, and do not look up any market's dispute status, by any
means.** More on why below.

## Answers to your open questions

- **Decile semantics: confirmed, exactly as you assumed.** `volume_decile` is
  1–10, **10 = highest volume**, and **null is a real value** meaning unknown
  stakes. Implemented that way, including for the two watchlist fields you
  added. (We use nine `percentile_cont` cuts rather than `ntile(10)` — same
  split, but it survives batching, and the corpus can't be ranked in one pass.)
- **Your 2024 question — checked, and your hypothesis is ruled out.** Sampled
  24 windows across the 2024 sweep's block span, unfiltered by requester:
  **100% of both `ProposePrice` and `DisputePrice` requesters are adapters we
  index**, zero unknown addresses. The denominator is not short, so the 2.90%
  baseline stands and the gap to UMA's ~1.3% is a population difference, not a
  measurement error. Good question; it was worth the 12k credits to close.
- **`contentHash`: we'll emit the canonical bytes**, as you suggested. One JCS
  implementation, served verbatim. Your spec is accepted as written, including
  hashing `textHash` rather than `rulesText` and anchoring via `appendAudit()`.
  Not built yet — it lands with `site-export.ts`.
- **Your six exporter fields are implemented**, plus `volume_usd` and
  `volume_decile` on watchlist entries.
- **Strategy market volume: we have ~$375.8M**, against the $60M–$150M you
  found in press. We are investigating which is right — do **not** cite either
  figure until it is settled.

## Something that affects your draft

The linter has now run over all 2,615,958 rules versions (5,183,533 hits).
You were right not to claim a detection on the Strategy market. We checked:

**`occurrence-vs-reporting` did not fire on it.** The market was flagged
(`hedge-words`, `no-na-condition`, `vague-source`) so it would reach a
watchlist, but not for the reason that actually broke it. Corpus-wide that rule
fires on 0.1% of markets, while `hedge-words` fires on 57.3% and
`no-na-condition` on 40.9%.

So: **do not add any claim that our linter would have caught this market**, and
if the draft implies it anywhere, remove the implication. It flagged it for
unrelated reasons, which is not the same thing and a reader will know it.

## Task 1 — small

Nothing new. The draft stays held for volume-conditioned rates, which now also
wait on the volume discrepancy above.

## Task 2 — the blinded ambiguity study (this is the important one)

**Why this exists.** Everything now turns on one question: *when a market ends
in a dispute, was the ambiguity visible in its listing-time text?* If yes, the
linter is merely weak and a better extractor fixes it. If no, listing-time
scoring has a ceiling no model can raise, and the product has to change shape.
This is the project's falsification test and it gates Phase 1.

**Why you.** Whoever judges must not know which markets were disputed. The
pipeline session does know, so its judgement is worthless here — it would find
ambiguity in every disputed market because it knows the answer. You will
receive a file where the two populations are shuffled together and unlabelled.
The blind is structural. Please do not defeat it: no DB queries, no searching
for these markets on Polymarket or elsewhere, no reasoning from "this one feels
famous". If you accidentally learn an item's status, say so and we drop it.

**Input:** `verdict/data/blind/ambiguity-study.json` — **170 items**, each
`{ item_id, question, category, listed_at, volume_usd, rules_text }`. Some were
later contested and some were not; the order is shuffled with a fixed seed and
**the proportion is deliberately not disclosed**, so please don't try to infer
or calibrate against one. Controls are matched to the contested set on listing
month, category and volume band — disputed markets skew political and
high-volume, and an unmatched comparison would measure "is this political"
rather than "is this ambiguous".

There is a `key.json` beside it holding the answers. **Do not open it.** The
whole measurement is void if you do, and it is trivially detectable afterwards
because the scoring compares your judgements against it. If you open it by
accident, say so — we regenerate with a different seed and lose nothing but
an hour.

**For each item, judge the text as it stands, as of its listing date:**

| Field | Values |
| --- | --- |
| `ambiguous` | `yes` / `no` — could a careful, motivated reader construct two defensible resolutions from this text? |
| `kind` | if yes: `timing-occurrence-vs-reporting`, `source-ambiguity`, `threshold-undefined`, `edge-case-unhandled`, `subjective-term`, `other` |
| `clause` | if yes: the shortest quoted span that carries the problem |
| `confidence` | 1–3 |

The standard is **not** "could anything conceivably go wrong" — nearly every
text fails that. It is: *is there a specific clause where two honest readers,
both trying to resolve correctly, could reach different answers?* If your `yes`
rate lands near 100%, the criterion is too loose and the result tells us
nothing; that is the main way this study fails.

Judge the text only. Do not use knowledge of how the world went, or of whether
the event happened. That is the same no-hindsight rule the dataset is built on.

**Output:** `prema-web/docs/AMBIGUITY-STUDY.md` with a results table keyed by
`item_id`, plus: your working definition of the threshold, roughly where you
drew the line, which items were hardest to call, and any `kind` category you
found yourself wanting that the list above lacks. That last one feeds linter v2
directly — the taxonomy matters as much as the rate.

Do **not** attempt to score yourself or compute a rate. Hand back raw
judgements; the pipeline session unblinds and scores them.

## Output

Report back with `AMBIGUITY-STUDY.md`, and flag anything that belongs in
`verdict/`.
