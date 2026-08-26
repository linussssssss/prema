# Prompt for Claude Fable 5 — direction-setting discussion (round 2)

*This is a **discussion**, not a report request. Paste everything below the line.
It is self-contained. If the model has a `research` skill, ask it to use that
for anything requiring external evidence.*

---

You wrote us a strategy analysis (`WHERETOGO.md`) a few hours ago. It was good
and we have acted on parts of it. **This is round two, and I want a conversation,
not another report.**

Two things have changed since you wrote:

1. New measurements, including one finding that did not exist when you wrote and
   that I think bears directly on your central recommendation.
2. On re-reading your analysis, I think you **underweighted the evidence side of
   the business** — the record itself, as opposed to the risk scoring. I want
   that stress-tested, including the possibility that I am wrong about it.

**How I want you to run this.** Before recommending anything: tell me what in the
new data changes your prior conclusions and what does not, and ask me whatever
you need to decide. I would rather spend a round on questions than get a
confident answer built on a wrong assumption. Then give me a direction — one
direction, with the reasoning, not a menu of options. I am trying to stop
building blindly, so a decisive answer is worth more than a balanced one.

Disagree with me freely, including about the evidence angle I am about to push.
If your original conclusion survives the new data, say so plainly.

---

## Where we landed from your round-1 analysis

Your conclusions, as I understood them:

- The dispute-prediction product is dead on the evidence. **We agree, and it is
  now conclusively dead** — see below.
- Chainlink is the wrong buyer; it builds rather than buys. The realistic set is
  compliance/surveillance (Solidus-type), ICE-via-Polymarket, or a venue's own
  rules-ops function.
- Reposition as the neutral, audit-grade **system of record for resolution
  quality**, with the live stakes-based watchlist as the only honest real-time
  hook.
- Regulation makes this **useful, not necessary** — Core Principle 14 is
  discretionary and the June 2026 NPRM does not touch it.
- Realistic exit is an acqui-hire/tuck-in, single-digit to low-tens of millions,
  inferred from comps because no resolution-risk acquisition comp exists.

---

## Part A — what the new measurements say

Full detail in the findings document I can paste on request; here is what
matters for direction.

### A1. Our corrections keep moving the numbers the same way

Every serious bug we have fixed has moved text lift **up** and stakes lift
**down**:

| Stage | Best text rule (stratified) | Stakes (top decile) |
|---|---:|---:|
| Pooled, unstratified | 20.69x | — |
| Stratified by category | 1.08x (within Politics) | — |
| Blinded human study (matched controls) | 1.46x | — |
| Full corpus, ~21x more positives | 1.57x | 6.45x |
| **After fixing a join bug that dropped 38% of disputes** | **1.93x** | **5.48x** |

The last row matters: our dispute set had been systematically excluding
negative-risk markets — a non-random exclusion along the exact axis (oracle
regime) that shifts dispute rates 20x. Fixing it took the disputed set from
2,089 to 3,317 markets and moved the best rule from 1.57x to 1.93x.

**So the text signal is not settled and the corrections keep going one way.** It
is still far too weak to be a product on its own. I am not arguing otherwise.

### A2. The dispute signal is dying faster than we told you

Not a step down to a plateau — a continuing decline, while volume grew 35x:

| Month | MOOv2 proposals | Dispute rate |
|---|---:|---:|
| 2025-09 | 13,711 | 0.263% |
| 2026-03 | 133,624 | 0.254% |
| 2026-06 | 244,805 | 0.100% |
| 2026-08 | 477,060 | **0.068%** |

Like-for-like the collapse is nearer **20x**, not the 8.4x we gave you. Your
kill-risk #1 ("the phenomenon evaporates faster than the pivot") is not a risk;
it is happening.

### A3. But the failures did not stop — they moved to channels the whitelist cannot suppress

**Voids.** A void (50/50 payout) needs no challenger, so a proposer whitelist
cannot suppress it. Voids went *up* as disputes fell. **August 2026: 325
disputes against 16,420 voids.** Void rate went from 0.05–0.5% (2025) to 2–4%
(2026). Stratified, this is not mechanical crypto ties (crypto never voids —
Bitcoin 0.000%); it is Esports 11.9%, Sports 3.2%, Tennis 2.5%. Honest caveat:
that looks substantially like real-world contingencies (cancellations, forfeits,
retirements) rather than pure rules ambiguity.

**Rules drift — the new finding, and the one I most want your view on.**

We discovered we could reconstruct post-listing rule changes retroactively. Every
on-chain `QuestionInitialized` event carries the rules text committed at listing
— immutable, timestamped, 100% populated across 2.17M events. Comparing it
against the venue's *current* text detects edits across the whole corpus:

| | count | share |
|---|---:|---:|
| compared | 2,017,202 | |
| identical | 1,984,941 | 98.4% |
| **rules changed after listing** | **32,258** | **1.6%** |

And it concentrates ~10–16x in exactly the categories where resolution requires
human judgement:

| Category | Drift rate |
|---|---:|
| Business | 26.3% |
| Awards | 15.8% |
| Politics | 15.1% |
| NBA | 13.2% |
| Movies | 9.2% |
| Sports / crypto (the corpus bulk) | ~0% |

**What this does not establish, and I will not claim:** not that any edit was
material or adverse (a typo fix counts); **not when the edit happened** — we
compare listing-time text to current text, so we cannot yet date it, and dating
it is exactly what would make an edit provably *retroactive*; and not that drift
predicts disputes or voids, which is unmeasured.

---

## Part B — the evidence angle I think you underweighted

You did centre the record — "system of record for resolution quality" is your
reframe and I am not disputing that you got there. My claim is narrower: you
developed it as a **compliance feed sold to a compliance function**, and skipped
two stronger versions. Please attack both.

**B1. You quoted the strongest fact in your own document and used it backwards.**

In your regulatory section you cite the Coalition for Political Forecasting
asking the CFTC to *"require that all DCMs maintain and publish a timestamped,
publicly accessible log of all amendments to individual contract rules,
resolution criteria, and the exchange's market rulebook."*

You cite this as evidence **against** the necessity argument, because it is
internal accountability rather than a mandated third party. But that log is
precisely the artifact we have just built — append-only, version-numbered,
content-hashed, and now demonstrated across 2M markets with 32,258 detected
amendments. If that requirement lands, every DCM must construct it, and we would
hold the only **independent historical** version, covering the period before
anyone was required to keep one.

Is that a real position or am I over-reading a single comment letter? What would
have to be true in the final rule for it to matter?

**B2. The litigation-evidence use is absent from your analysis.**

You list the 2026 cases (Risch v. Kalshi; Wood & Bush v. Polymarket) as *market
signals* — proof that disputes are costly. You never treat our record as
**evidence in** them. Wood & Bush is a retroactive-rule-change claim. A
hash-chained, hindsight-free record of what the rules said at listing versus at
resolution is the artifact that settles that class of dispute, and we now have
both versions for 32,258 markets.

That implies a different buyer set than compliance vendors — litigation support,
e-discovery, expert-witness firms, insurers underwriting venue liability — and a
much sharper necessity argument, because litigation does not care whether a
regulator mandated the record.

Is this a real market or am I pattern-matching on two lawsuits? What is the
actual size and sales motion of forensic/expert-evidence data businesses, and
has anyone built one on a public-chain dataset?

**B3. Verifiability as the product, not a feature.**

Our records are canonically hashed (RFC 8785) with an append-only chain, so a
third party can verify a claim without trusting us. You said "checkable" once and
moved on. Does provable non-tamperability change who buys this, or is it an
engineering nicety that no buyer prices?

---

## Part C — the decision I need

I am trying to stop building blindly. Concretely:

1. **Does the drift finding change your central recommendation?** You concluded
   "resolution risk is a feature, not a company." Does a unique, retroactive,
   litigation-shaped record of rule changes across a 2M-market corpus change
   that — or is it a better feature attached to the same someone else's product?

2. **Which signal do we build the product on?** Disputes are dying (0.068% and
   falling). Voids are 50x more common and growing but look partly like real-world
   contingency. Drift is rare (1.6%) but concentrated exactly where judgement and
   litigation live. Pick one as the spine and say why.

3. **Is dating the edits worth building next?** It is the difference between "the
   rules changed at some point" and "the rules changed *after* people traded and
   *before* it resolved." It is buildable but not free. Does the evidence/
   litigation thesis live or die on it?

4. **Does any of this move the acquirer set** you gave us, or the realistic
   valuation range?

5. **What is the falsification test for the direction you pick?** Give me the
   measurement that would tell us within weeks that we are wrong again. We have
   killed one thesis on evidence already and want the next one to be equally
   falsifiable.

## Constraints (unchanged, non-negotiable)

We never operate a market, take positions, hold customer funds or keys, or issue
a token. Neutrality enforced in code. No hindsight leakage — all retrieval takes
`published_before`. Everything decision-relevant is append-only and hashed.
Model outputs are "recommended outcome, not a ruling." Single founder, single
VPS, no revenue. Anything requiring us to break a constraint is out of scope;
treat the constraints as the asset to exploit.

## How to answer

Questions first if you have them. Then one direction, with reasoning and
sequencing — "build X before Y because Z." Evidence over reasoning: cite real
cases, companies, filings, with sources, and label speculation as speculation.
If the honest answer is still "this is a feature, sell it to a venue," say that
and tell me which venue and what the sales motion is.
