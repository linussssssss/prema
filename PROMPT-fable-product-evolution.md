# Prompt for Claude Fable 5 — Prema product evolution toward institutional acquisition

*Paste everything below the line. It is self-contained: assume the model has no
access to our repo, so all facts are inline. Ask it to invoke the `research`
skill first if one is available.*

---

Please use the **research skill** for this (if you have one available; otherwise
research it directly with your own tools). I need external evidence, not just
reasoning from the brief I'm giving you.

## Your task

I run a company called **Prema**. I want you to figure out the **product
evolution path** — how we get from where we are now to being an attractive
acquisition target for an institution in the oracle/data infrastructure space
(**Chainlink is the named example**, but challenge that: tell me who the real
buyers are). Critically, I need to know **how that path shapes what we build
right now**, in the next 3, 6 and 12 months.

I am giving you an honest and deliberately unflattering picture. Our original
product thesis has partially failed under measurement, and I would rather you
work from the real numbers than a pitch. **Do not be agreeable about this** — if
the conclusion is that the current direction does not lead to an acquisition, say
so and tell me what would.

## What Prema does

We analyse **resolution risk in prediction markets** — the risk that a market's
stated rules fail to cleanly determine an outcome, producing a dispute, an
arbitrary judgement call, or a void.

The venue we've modelled is **Polymarket**, resolved via **UMA's Optimistic
Oracle**: a proposer asserts an outcome, anyone can dispute within a challenge
window, and disputes escalate to UMA's DVM (a token-holder vote).

## Hard constraints — do not propose anything that breaks these

- We never operate a market, take positions, hold customer funds or keys, or
  issue a token.
- Neutrality is enforced in code and process (COI attestations per case, random
  reviewer assignment, append-only logs).
- **No hindsight leakage, ever.** All retrieval takes a `published_before`
  parameter and refuses to run without it.
- Everything decision-relevant is append-only and hashed (a verified hash chain);
  decision-relevant rows are never updated, only superseded.
- Model outputs are "recommended outcome, not a ruling", never presented as fact.

These rule out most crypto business models — token, market-making, custody,
staking, running our own venue. Proposals requiring any of those are out of
scope. Treat the constraints as an asset to be exploited, not an obstacle.

## The strategy as currently conceived

A three-stage lever:

1. **Public disclosure** — publish the record.
2. **Trader attractability via risk scoring their bets** — scoring is the hook
   that brings traders in.
3. **Pivot to institutional attractiveness** — the end goal, oriented toward
   acquisition.

**Stage 2 is what the measurements have called into question.** That is why I'm
asking.

## What exists today (built, running, real)

A TypeScript monorepo on Postgres, on a single VPS:

| Asset | Scale |
|---|---|
| Markets (full Polymarket corpus) | **2,615,958** |
| Listing-time rules text, immutable v1 per market | 2,615,958 |
| On-chain resolution events (Polygon complete to head) | **9,501,078** |
| UMA DVM votes (Ethereum complete) | 2,023,767 |
| Rule-linter hits (7 rules, whole corpus) | 5,670,580 |
| Labels | 44,726 contested · 2,089 disputed |
| Dispute records | 4,127 |
| Audit log | Hash chain, verified intact |

Plus: a rules linter, a stratified signal-analysis harness, a blinded
human-judgement study harness, CSV/Parquet export, a canonicalised (RFC 8785
JCS) content-hash publication path, and a validation suite with sanity gates.

**The dataset is hindsight-free by construction** — rule flags are computed
against the text *as listed*, never the latest text. Those two diverge precisely
on markets whose rules were edited after listing, in the direction that would
flatter us.

## What we measured, and how the thesis broke

**1. Listing-time text is a weak predictor of disputes.** Three independent
methods agree on **1.4–1.6x**:
- Blinded human study, controls matched on month/category/volume: **1.46x**
  (44.1% vs 30.1%, n=151, p≈0.075; p≈0.026 restricted to confident judgements)
- Stratified rule lift, full corpus, best rule: **1.57x**
- Same rule in the top volume decile: **1.65x**

An earlier reading of 2.02x did not survive at ~21x more positives.

**2. Uncontrolled numbers were badly wrong (Simpson's paradox).** Pooled, our
best rule reads **20.69x**; stratified by category, **3.37x**. One rule read
20.66x pooled and **1.08x within Politics**. Cause: Sports is 1.38M of 2.6M
markets and almost never disputes, so any rule firing more on Politics inherits
the gap for free. Every number must be stratified.

**3. Ambiguity is common; disputes are rare.** ~30% of *non-disputed* markets
carry visible listing-time ambiguity, against a ~0.1% dispute base rate. A
perfect binary ambiguity screen would flag a third of the corpus to catch under
half the disputes. This is a ceiling in the signal, not a model-quality problem.

**4. Stakes predict ~4x better than text — but are unusable at listing time.**
Top volume decile runs **6.45x** against disputes (532 category strata, pooled
9.51x), holding inside every large category. Dispute rate climbs monotonically
**0.020% → 0.514%** across volume deciles. **But** that's *final* volume, unknown
at listing — using it to score listings is hindsight and breaks our own rule. It
is legitimate only as a *running* feature (volume-to-date on a live market),
which supports a continuously re-ranking **watchlist**, not a score-at-listing
product. So the strong signal doesn't fit the planned shape, and the signal that
fits is weak.

**5. The thing we predict is becoming rarer.** UMA introduced a
**ManagedOptimisticOracleV2** with a **proposer whitelist** (enforced
2025-09-05):

| Oracle | Proposals | Disputes | Rate |
|---|---:|---:|---:|
| open (`oov2`) | 162,617 | 1,777 | **1.093%** |
| whitelisted (`moov2`) | 1,797,469 | 2,350 | **0.131%** |

An **8.4x collapse**. Disputes didn't stop being real — resolution authority
concentrated into a small whitelisted set, and the public adversarial signal
went with it. **I want your view on this specifically:** does risk moving from a
public adversarial process into a private discretionary one make a neutral
external record *more* valuable, or is the observable phenomenon we built on
evaporating? I genuinely don't know.

**6. Known data limits.** 38% of dispute events don't join to a market, and the
loss is non-random (clusters by oracle: 77.9% vs 41.4%), so our disputed set
over-represents the post-whitelist regime. Our composite label is 95.5% "market
voided 50/50", which measures voidability rather than dispute risk. Two of seven
linter rules carry no signal; one fires on 57% of the corpus.

## The marketability problem, plainly

1. We can't honestly sell "we predict which markets will be disputed" — the
   effect size doesn't support it, and we won't publish inflated numbers.
2. The strongest signal is unusable in the planned product shape.
3. The base rate is collapsing 8.4x because of a venue governance change we don't
   control.
4. Ambiguity is too common to filter on.
5. We're single-venue (Polymarket) and single-oracle (UMA) — a concentration
   risk, and possibly also the acquisition thesis.

## What we suspect is valuable (hypotheses — test them, don't accept them)

- **The dataset**: 2.6M markets, 9.5M events, hindsight-free, hash-chained. Hard
  to rebuild; makes anyone else's resolution-risk claims checkable.
- **The neutrality architecture**, enforced in code rather than policy.
- **The live watchlist mechanism** (stakes-based, 6.45x, legitimate).
- **The regime-break insight** — we can measure what the whitelist did.

## What I want from you

1. **Who actually buys this, and why.** Chainlink is my assumption — pressure
   it. Consider oracle providers (Chainlink, UMA itself, Pyth, RedStone),
   prediction-market venues (Polymarket, Kalshi), exchanges, traditional market-
   data and index providers (S&P, MSCI, ICE, Bloomberg), ratings agencies, and
   compliance/RegTech buyers. For each: what specifically would they be
   acquiring — the data, the method, the team, a defensive move, a regulatory
   credential? Ground this in **actual comparable acquisitions** with real
   examples, and say what those deals valued.
2. **The evolution path.** Concrete stages from here to acquirable. What has to
   be true at each stage, and what's the evidence a stage is complete?
3. **How this reshapes the product now.** Given stage 2 (trader attractability)
   is weaker than hoped — does it still work with a different mechanism (live
   stakes-based scoring instead of listing-time text)? Or should the sequence
   change? Be specific about the next 3, 6, 12 months.
4. **Single-venue risk.** Is expanding beyond Polymarket/UMA (to Kalshi, sports
   books, other oracles) necessary for an acquisition, or does depth on the
   dominant venue matter more?
5. **The regulatory angle.** Prediction markets are under active regulatory
   development (CFTC and equivalents). Does a neutral, audit-grade resolution
   record have a compliance or dispute-adjudication role that makes it
   *necessary* rather than merely useful? This feels like our strongest card and
   I want it stress-tested.
6. **What kills us.** The most likely ways this ends up worth nothing, and the
   earliest signals of each.

## How to answer

- **Evidence over reasoning.** Cite real acquisitions, real companies, real
  regulatory developments, with sources. Where you're speculating, label it.
- **Lead with the answer**, then support it. No throat-clearing.
- **Be concrete about sequencing** — "build X before Y because Z" beats a list of
  good ideas.
- **Disagree with me where the evidence does.** I would rather find out now that
  the plan is wrong than after another six months of building. If the honest
  answer is that resolution risk is a feature and not a company, say that
  clearly and tell me what the feature attaches to.
- Flag anything where you'd want data I haven't given you.
