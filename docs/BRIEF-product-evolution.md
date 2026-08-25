# BRIEF — Prema: what we built, what we measured, and why the product is unclear

Written 2026-08-25 as the input to an external strategy consult. This is the
honest state of the company: what exists, what the data actually says, and the
specific ways the original product thesis failed. It is deliberately unflattering
where the evidence is unflattering.

---

## 1. What Prema is

Prema (internal codename "Verdict") analyses **resolution risk in prediction
markets** — the risk that a market's stated rules fail to cleanly determine an
outcome, leading to a dispute, an arbitrary judgement call, or a void.

The venue we have modelled is **Polymarket**, whose markets are resolved through
**UMA's Optimistic Oracle**. A proposer asserts an outcome; anyone may dispute it
within a challenge window; disputes escalate to UMA's DVM (a token-holder vote).

### Hard constraints — these are company-defining and not negotiable

- We never operate a market, take positions, hold customer funds or keys, or
  issue a token.
- Neutrality is enforced in code and process: conflict-of-interest attestations
  per case, random reviewer assignment, append-only logs.
- **No hindsight leakage, ever.** All retrieval takes a `published_before`
  parameter and refuses to run without it. This is enforced, not aspirational.
- Everything decision-relevant is append-only and hashed (a verified hash chain).
  Decision-relevant rows are never updated, only superseded by a new version.
- Model outputs are "recommended outcome, not a ruling" — never presented as
  fact.

These constraints rule out most crypto business models (token, market-making,
custody, staking). **Any proposal that requires breaking one is out of scope.**

## 2. The strategy as currently conceived

A three-stage lever:

1. **Public disclosure** — publish the record.
2. **Trader attractability via risk scoring their bets** — scoring is the hook
   that brings traders in.
3. **Pivot to institutional attractiveness** — the end goal, oriented toward
   acquisition (Chainlink is the named example).

Stage 2 is the one the measurements have put in question. That is the reason for
this consult.

## 3. What actually exists today (all built and running)

A TypeScript monorepo on Postgres 16, running on a single VPS.

| Asset | Scale | Notes |
|---|---|---|
| Markets | **2,615,958** | Full Polymarket corpus via Gamma API |
| Listing-time rules text | 2,615,958 | One immutable v1 row per market |
| On-chain resolution events | **9,501,078** | Polygon complete to head (block 92,626,114) |
| DVM votes | 2,023,767 | Ethereum complete to block 25,830,831 |
| Linter hits | 5,670,580 | 7 rules, v1.1.0, over the whole corpus |
| Labels | 2,615,958 | 44,726 contested · 2,089 disputed |
| Dispute records | 4,127 | Full dispute history |
| Audit log | Hash chain | Verified intact |

Also built: a rule linter, a stratified signal-analysis harness, a blinded
human-judgement study harness, CSV/Parquet export, a canonicalised
(RFC 8785 JCS) content-hash publication path, and a validation suite with sanity
gates. A marketing website exists in a separate repo and vendors the real linter.

**The dataset is hindsight-free by construction.** Rule flags are computed
against `version_num = 1` (the text as listed), never the latest text. This
matters more than it sounds: the two diverge precisely on markets whose rules
were edited after listing, in the direction that flatters us.

## 4. What we measured — and where the thesis broke

### 4.1 Listing-time text is a weak predictor of disputes

Three independent methods now agree the signal is real but modest, **1.4–1.6x**:

| Method | Result |
|---|---|
| Blinded human study, controls matched on month/category/volume | **1.46x** (44.1% vs 30.1%, n=151 ex-disclosed, p≈0.075; p≈0.026 restricted to confident judgements) |
| Stratified rule lift, full corpus, best rule (`vague-source`) | **1.57x** |
| Same rule inside the top volume decile | **1.65x** |

An earlier reading of **2.02x** did not survive at ~21x more positives.

### 4.2 The uncontrolled numbers were badly wrong — a Simpson's paradox

Pooled across the corpus, rule lift looks spectacular: `hedge-words` reads
**20.69x**. Stratified by category it is **3.37x**, and one rule
(`status-verb-gap`) read 20.66x pooled and **1.08x within Politics**.

The cause: Sports is 1.38M of 2.6M markets and almost never disputes. Any rule
that fires more often on Politics than Sports inherits that gap for free. **Every
headline number we produce must be stratified.** We got this wrong once and
corrected it; it is the single biggest analytical trap in this dataset.

### 4.3 Ambiguity is common; disputes are rare

The blind study's most important result is about the controls, not the cases:
**~30% of non-disputed markets carry visible listing-time ambiguity.** At a
~0.1% dispute base rate, a perfect binary ambiguity screen would flag roughly a
third of the corpus to catch under half the disputes.

**Text ambiguity alone cannot be the headline claim.** This is not a model
quality problem that a better extractor fixes — the ceiling is in the signal.

### 4.4 Stakes predict ~4x better than text — but are unusable at listing time

Given the same stratified treatment, the top volume decile runs **6.45x** against
`disputed` (532 category strata, pooled 9.51x), holding independently inside
every large category. Dispute rate climbs monotonically **0.020% → 0.514%**
across volume deciles, a 25.7x spread.

**The catch:** `volume_usd` is *final* volume, which is not known when a market
lists. Ranking listings by it is hindsight and breaks our own non-negotiable. It
is legitimate only as a **running** feature — volume-to-date on a live market —
which supports a continuously re-ranking watchlist, **not** a score-at-listing
product.

So: the strong signal cannot be used in the originally-planned product shape, and
the signal that can be used in that shape is weak.

### 4.5 The thing we predict is becoming rarer

UMA introduced a **ManagedOptimisticOracleV2** with a **proposer whitelist**
(enforced 2025-09-05). Dispute rates before and after:

| Oracle | Proposals | Disputes | Rate |
|---|---:|---:|---:|
| `oov2` (open) | 162,617 | 1,777 | **1.093%** |
| `moov2` (whitelisted) | 1,797,469 | 2,350 | **0.131%** |

An **8.4x collapse** — but that pooled figure is a blend across time, and the
monthly series (measured 2026-08-25, after the consult brief was written) shows
something worse and more decision-relevant:

| Month | MOOv2 proposals | MOOv2 dispute rate | OOv2 dispute rate |
|---|---:|---:|---:|
| 2025-07 | 0 | — | 1.380% |
| 2025-09 | 13,711 | 0.263% | 0.633% |
| 2025-12 | 33,780 | 0.367% | 0.605% |
| 2026-03 | 133,624 | 0.254% | 0.411% |
| 2026-06 | 244,805 | 0.100% | 0.752% |
| 2026-08 | 477,060 | **0.068%** | 0.263% |

Three corrections to our own story:

1. **The 2025-09-05 date is confirmed.** MOOv2 carries 11 proposals in August
   2025 and 13,711 in September. (A secondary source dating the "major overhaul"
   to November 2025 is probably describing when MOOv2 overtook OOv2 by volume —
   27,378 vs 9,866 that month — not when it was enforced.)
2. **It is not a step change to a new plateau — it is a continuing decline.**
   MOOv2's dispute rate falls steadily from 0.263% to 0.068% over twelve months.
   The pooled 0.131% averages a high-early period against a low-recent one.
3. **Like-for-like, the collapse is nearer 20x than 8.4x.** Current-regime MOOv2
   (0.068%) against pre-whitelist OOv2 (~1.38%). And OOv2 is now vestigial —
   1,140 proposals in August 2026 against MOOv2's 477,060 — so essentially all
   resolution flows through the low-dispute channel now.

Meanwhile proposal volume grew **35x** (13,711 → 477,060/month). Polymarket got
much bigger while the observable dispute rate fell by an order of magnitude.

Disputes did not stop being real — resolution authority concentrated into a
small whitelisted set of proposers, and the public adversarial signal
disappeared with it.

**Strategic reading (unverified, worth challenging):** risk moved from a public,
observable process into a private, discretionary one. That could make a neutral
external record *more* valuable, or it could mean the observable phenomenon we
built a company on is evaporating. We do not know which.

### 4.6 Known data-quality limits

- **38% of dispute events do not join to a market** (62.2% join rate), and the
  loss is **not random** — it clusters by oracle (`moov2` 77.9% matched, `oov2`
  41.4%) while being flat by year. So the 2,089 disputed markets over-represent
  the post-whitelist regime along exactly the dimension that shifts dispute rates
  8.4x. Being fixed now.
- **The composite `contested` label is 95.5% `resolved_na`** (market voided
  50/50), which measures *voidability*, not dispute risk. Its other components
  are inert: `escalated` covers 6 markets, `rules_edited_after_listing` is 0
  until a long-running worker has been collecting for weeks.
- Two of seven linter rules carry no signal at all; one (`hedge-words`) fires on
  57% of the corpus, so it cannot rank anything regardless of its lift.

## 5. The marketability problem, stated plainly

1. We cannot honestly sell **"we predict which markets will be disputed."** The
   effect size does not support it, and we will not publish inflated numbers.
2. The **strongest signal (stakes) is unusable at listing time** without breaking
   our own hindsight rule.
3. The **base rate is collapsing** (8.4x) because of a venue governance change we
   do not control.
4. **Ambiguity is too common to filter on** — a third of all markets have it.
5. We are **single-venue** (Polymarket) and **single-oracle** (UMA). That is a
   concentration risk and possibly also the acquisition thesis.

## 6. What we believe is genuinely valuable

Offered as hypotheses to test, not conclusions:

- **The dataset.** 2.6M markets and 9.5M resolution events, assembled with
  hindsight-free discipline and an append-only hash chain. Hard to rebuild, and
  it makes anyone else's claims about resolution risk checkable.
- **The neutrality architecture.** Enforced in code, not policy. To an acquirer
  who must be seen as impartial, that may be the asset.
- **The live watchlist mechanism.** Stakes-based re-ranking is strong (6.45x)
  and legitimate.
- **The regime-break insight.** We can measure what the whitelist did to dispute
  behaviour. Few others can.

## 7. What we are asking

How does this become an acquisition target? Specifically: what does the product
need to be at 3, 6 and 12 months, given that the original scoring thesis is
weaker than hoped and the phenomenon being measured is shrinking?
