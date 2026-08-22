# Verdict — Plan (v0)

> Source of truth for product scope. Seeded 2026-08-22 from the founding brief
> (no separate plan doc existed; see ADR-0001). Edit deliberately; technical
> decisions go to `docs/DECISIONS.md`.

## Mission

Be the neutral resolution layer for the 10–15% of prediction-market outcomes
that automation cannot settle — the markets where the *wording* is the problem,
not the data.

## Why now (Aug 2026)

- Prediction markets settled ~$50B of volume in July 2026. Objective markets
  are resolved by automated oracles (Chainlink, UMA's OOTruthBot). The
  ambiguous tail is resolved by token vote (Polymarket/UMA DVM) or in-house
  teams (Kalshi, Polymarket US).
- No precedent database, no structured evidence, no independent appeal, no
  audit trail. Disputes at record highs; traders suing Polymarket and Kalshi;
  CFTC rulemaking open; Kalshi CEO admits rule disclosure needs improving.
- 2026 academic work: off-the-shelf LLMs resolve ~83–89% of questions
  correctly, but only ~84–85% on politics/crypto — where the money is lost.

## Product (built in this order)

- **A. Ambiguity / dispute-risk score.** At listing: 0–100 probability the
  market will be contested, typed ambiguity flags, suggested rewrite, closest
  precedents. Sold as API + webhooks (bots/MMs) and listing gate (venues).
- **B. Evidence & precedent engine.** On contest: timestamped hashed source
  snapshots, facts mapped to rule clauses, precedents by crux type,
  multi-model adjudication (independent runs, confidence-weighted aggregation,
  adversary run). Output: JSON+PDF bundle with recommended outcome,
  confidence, dissent. Sold per case.
- **C. Appeals desk.** Human reviewers with COI attestations sign decisions on
  bundles; bundles/decisions/audit-log heads hash-anchored on Base via a small
  registry contract. Sold to venues as escalation + precedent-corpus licence.

## Horizons

- **90 days:** public reference for resolution risk — dataset of every
  Polymarket/UMA resolution since 2024, published calibration page for the
  ambiguity score, retro-adjudications with accuracy shown openly. Nothing is
  sold before the calibration page is live.
- **12–18 months:** paid infra — risk-score API subscriptions, evidence
  bundles per dispute, one regulated venue using the listing gate/escalation
  desk. Seed round on that evidence.
- **3–5 years:** the layer everyone routes to; corpus licensing; likely
  acquisition by an oracle network, venue, or exchange-data company. The
  company must be worth more for being neutral.

## Non-negotiables

1. Never operate a market, take positions, hold customer funds/keys, or issue
   a token.
2. Neutrality enforced in code and process: COI attestations per case, random
   reviewer assignment, append-only logs.
3. No hindsight leakage: all retrieval is publication-date-filtered; backtests
   use a fixed time split committed in code.
4. Everything decision-relevant is append-only and hashed. New versions are
   appended, never overwritten.
5. Outputs are "recommended outcome, not a ruling" unless a venue contract
   says otherwise. Never present a model's verdict as fact.

## Key technical facts

- Polymarket resolution runs through UMA's Optimistic Oracle: OOv2
  historically, Managed OOv2 (whitelisted proposers, ~37 addresses) since late
  2025. Proposal → 2h challenge window → dispute → DVM token vote (VotingV2 on
  Ethereum mainnet). Polymarket CTF Adapter contracts on Polygon carry
  canonical rules text as ancillary data.
- MOOv2 suppresses disputes → raw "disputed" label is sparse and biased → we
  use a composite **contested** label.
- Gamma API moved `/markets` and `/events` to cursor pagination April 2026.
- Kalshi exposes `rules_primary`/`rules_secondary`; Kalshi + Polymarket US
  resolve in-house, so rule *edits* and settlement delays are the contest
  signal there.

## Composite "contested" label

Each stored as its own boolean;
`contested = disputed OR escalated OR resolved_na OR rules_edited_after_listing`.
Auxiliary (not part of target): `price_reversal`, `manual_flag`.

- `disputed`: any `DisputePrice` on the market's oracle request.
- `escalated`: a DVM vote occurred.
- `resolved_na`: final payout vector 50/50 (or venue-equivalent invalid).
- `rules_edited_after_listing`: >1 differing-hash rules version after first trade.
- `price_reversal`: mid > 0.80 or < 0.20 within 24h of close, settled other
  way; or unusual challenge-window volatility.
- `manual_flag`: human-set, with note.

## Linter v1 starter rules

1. Hedge words (credible, widely reported, significant(ly), official(ly),
   substantial, confirmed, announced, effectively, widely).
2. Deadline without timezone or inclusive/exclusive semantics.
3. Occurrence-vs-reporting gap (event by D, source publishes with lag).
4. Status-verb definitional gap (leave office, resign, launch, … without
   enumerated edge cases).
5. Source clause names publisher but no specific feed/page, or source may not
   exist at resolution time.
6. Multi-outcome market not obviously exclusive/exhaustive, no Other/N/A.
7. No N/A / invalidity condition at all.

Severities are first guesses; calibrate against the label in Phase 1.

## Phase 0 definition of done

Fresh clone → `docker compose up -d` → `pnpm install && pnpm db:migrate &&
pnpm dataset:build` → Parquet/CSV exports + `data/REPORT.md` exist;
`pnpm test` green; linter flags (a) a "by <date>" clause with no
occurrence-vs-reporting semantics and (b) a status verb with no enumerated
edge cases, on real historical markets. Sanity: disputes Jan–May 2026 in the
~1,000+ range.

## Backlog (Phase 1+; not started)

- Phase 1: LLM clause extractor, precedent retrieval, LLM judge, isotonic
  calibration in `/eval`, public `/calibration` page, daily riskiest-markets
  digest, free API tier.
- Phase 2: evidence engine (research-plan agent, date-filtered retrieval,
  snapshotter, claim extraction, 3+1 adjudication, bundle renderer+hashing),
  retro-adjudication of every escalated dispute since 2024, Stripe billing.
- Phase 3+: Kalshi + Polymarket US ingestion, precedent taxonomy, reviewer
  workflow with COI attestations, `EvidenceRegistry.sol` on Base, appeals
  desk, corpus licence.

## Constraints

- Founder: CS student, Berlin; TS/Node, Python, Docker, Solidity (Foundry),
  Anthropic API. Budget < €150/month infra + model spend in Phase 0–1.
  Co-founder ~month 3.
- Threat: in-house build at Kalshi/Polymarket US → speed and the public
  calibration record beat polish.
