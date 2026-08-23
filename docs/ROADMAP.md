# Prema — Roadmap: from today to a founded startup

Anchor date: 2026-08-23. Companion to `docs/PLAN.md` (product), `MARKETING.md`
(GTM), `STATUS.md`/`TODO.md` (state), and the legal notes below. Timeboxes are
relative to "now" and deliberately aggressive on the one thing that compounds —
the public track record — and patient on everything that doesn't.

Guiding doctrine (unchanged): **neutrality is the moat; the public calibration
record is the flagship; sell nothing before it's live; ship the record first,
polish last; measure before optimizing.** Two clocks: ~months to *start* the
record, ~12–24 months to *own* the position.

---

## Current standpoint (2026-08-23)

- **Backend (Phase 0)** essentially built: monorepo, schema + migrations, the
  deterministic linter, Gamma ingestion, on-chain indexers (Polygon + Ethereum
  DVM), composite `contested` label, exports, the validator, and the
  post-mortem generator. **First full uncapped backfill is running** on
  Postgres (1.9M+ markets and climbing) — not yet validated.
- **Website**: full build brief written (`docs/WEBSITE_BRIEF.md`); a separate
  session is building the Astro marketing site (`prema-web`).
- **Corporate/legal**: none yet. No entity, no legal opinion, no Impressum, no
  insurance. Repo private on GitHub (`linussssssss/prema`).
- **Commercial**: no public presence, no revenue, no customers.
- **Team**: solo (Linus). Co-founder expected ~month 3.
- **Budget**: ~€0 spend; target < €150/month through Phases 0–1.

---

## Phase 0 — Prove the foundation (now → ~4 weeks)

**Goal:** a *trustworthy* dataset, a live (pre-launch) website, and the cheap
legal hygiene done. **Exit gate:** validator passes the dispute sanity check;
site live with Impressum + privacy policy; MOOv2 question answered; run-#2
scoping decided; specialist legal consult booked; dataset backed up offsite.

**Research / Data**
- Let the backfill finish; run `pnpm --filter @verdict/data run validate`.
- Interpret the **dispute sanity gate** (~1,000+ disputes Jan–May 2026). If it
  fails while chain indexing is complete, stop and diagnose (MOOv2, decode,
  filter) before trusting anything.
- **Resolve the MOOv2 question**: `SELECT DISTINCT resolved_by`, check
  `optimisticOracle()` on each adapter, enumerate any unknown adapter, re-index
  if needed; write the ADR.
- Verify the **questionId join rate** (should be ~100% post-2024).
- **Smoke-test the post-mortem generator** on one real, known dispute.
- Decide **run-#2 scoping** — skip the millions of high-frequency, auto-resolved
  series that never dispute (they dominate the ~2M corpus and the runtime); ADR
  it. Keep the full set once as the calibration denominator.

**Development / Infra**
- Offsite **backup** of the dataset (currently single-copy on one laptop).
- Apply the measured re-run optimizations (batch Gamma upserts, pipeline
  fetch+write, `synchronous_commit=off` for loads) — the I/O profile is known
  (~27% CPU; the wait dominates).
- Stand up the **recurring worker** (daily watchlist, open-market rules
  re-polls, CLOB snapshots) once Redis is running.
- CI green on every push; basic observability/log retention.
- Watch disk (C: ~95% full); free space or move Docker data root.

**Marketing**
- Secure the **domain**, wordmark, and X/Twitter handle for Prema.
- Finish the website; keep it to a credible holding page + waitlist — nothing
  claimed, no fake numbers.
- Draft (don't publish) the first 2 dispute post-mortems from the validated data.

**Legal / Corporate**
- Add **Impressum (§5 DDG)** + **Datenschutzerklärung** to the site — legally
  required now; missing Impressum invites Abmahnung.
- Lock a **GDPR lawful basis** for the waitlist; minimal-tracking design keeps
  cookie-consent light.
- **Trademark search** for "Prema" (DPMA + EUIPO) and domain availability before
  committing the brand.
- **Book the specialist consult** (Fintech-Regulierung + Glücksspilrecht) for
  the classification question in Phase 1.
- Begin **UG formation** prep (notary, Gesellschaftsvertrag, capital).

---

## Phase 1 — Build the public record (weeks 4–12 / months 1–3)

**Goal:** the **calibration page live** and the timestamped track record started
— the single most important milestone in the whole plan. **Exit gate:** public
`/calibration` + daily watchlist live; UG formed; classification legal opinion
in hand; co-founder onboarded with signed agreements.

**Research / ML**
- **LLM clause extractor** (structured outputs via `packages/llm`: zod schemas,
  cost metering, `model_version` on every row).
- **Precedent retrieval** over contested markets (pgvector embeddings).
- **Baseline risk model + isotonic calibration** in `/eval` on the *fixed* time
  split (train ≤ 2025-12-31, validate 2026 H1, test rolling monthly). Train on
  version-1 (listing-time) rules rows — no hindsight.
- **Retro-adjudicate a first batch** of escalated disputes to seed the record.

**Development**
- Public **`/calibration` page** — predicted vs realized dispute rates, by
  category, updated automatically, methodology + time split published.
- Automated daily **"riskiest open markets" digest** (render, don't write).
- **Free API tier** scaffolding (metered, delayed data) + webhooks.
- Productionize the **post-mortem pipeline**.

**Marketing**
- **Soft launch**: publish the dataset/methodology write-up (HN, X, UMA
  Discourse); first 2 post-mortems; start the daily watchlist; begin
  **hashed, timestamped pre-resolution calls** (the track record itself).
- Goal is the *right* ~20–200 followers (traders, UMA voters, MM engineers),
  not vanity reach.
- File a **CFTC rulemaking comment** citing the dataset — free, citable, and
  instantly separates Prema from anonymous crypto tools.

**Legal / Corporate**
- **Form the UG (haftungsbeschränkt)** — ring-fence personal assets *before* any
  revenue or contract. Convert to GmbH later.
- Obtain the **classification opinion** (gambling vs financial-services). This
  **gates monetization** — do not sell before it's in hand.
- Engage a **Steuerberater**; Gewerbeanmeldung; business-liability +
  pure-financial-loss insurance quotes.

**Team**
- **Onboard the co-founder (~month 3)**: IP assignment, vesting, cap table,
  clear role split (founder = product/eng; co-founder = distribution or venue
  sales — whichever the founder is weaker at, not more engineering).

**Fundraising:** none. Accumulate the *evidence* a raise will need (track
record, usage, methodology).

**Success metrics:** days of uninterrupted track record (the north star);
calibration curve published; post-mortems shipped; waitlist → digest opens; the
right followers.

---

## Phase 2 — Monetize & prove demand (months 3–9)

**Goal:** first revenue, the evidence engine, first customers. **Exit gate:**
paying bot/MM customers at real MRR; evidence bundles selling per dispute; first
venue conversation live; Stripe + AGB in force.

**Research / Development**
- **Evidence engine (Product B)**: research-plan agent → date-filtered
  retrieval (the `publishedBefore` guard is already enforced) → snapshotter to
  R2/MinIO → claim extraction → **3+1 multi-model adjudication** (independent
  runs, confidence-weighted aggregation, an adversary run) → bundle renderer +
  hashing (JSON + PDF, recommended outcome + confidence + dissent).
- **Retro-adjudicate every escalated dispute since 2024** — builds the corpus
  and doubles as marketing.
- **Billing** (Stripe), metering, tiered API.

**Marketing / Sales**
- API **free → paid** tiers (bot/trader ~€99/mo; MM/desk ~€500–1,500/mo — all
  hypotheses to validate). DM the first ~30 bot operators personally.
- **Evidence bundles** sold to large position holders during live disputes —
  monetizes exactly the moments the post-mortems already spotlight.
- Quarterly **"State of Resolution Risk"** report (citable PDF).

**Legal / Corporate**
- **AGB with liability caps** (real latitude in B2B; cannot exclude
  intent/gross negligence); customer contracts; **VAT/OSS** for cross-border
  digital sales; DPAs; insurance in force. Revisit gambling posture as the
  customer base grows.
- Consider **UG → GmbH** conversion; proper banking/accounting.

**Team/Ops:** first contractor/hire if revenue supports; clean cap table.

**Fundraising:** open **seed conversations** on the calibration record + paying
customers + a venue pipeline. Narrative: "the Moody's of market wording."

**Success metrics:** weekly-active API keys; paid conversions; €MRR; citations
(newsletters, papers, the CFTC docket); pre-resolution call accuracy vs baseline.

---

## Phase 3 — Founded startup: seed & first venue (months 9–18)

**Goal:** the "founded startup" endpoint — incorporated, funded-or-fundable,
staffed, defensible, with a venue contract. **Exit gate:** seed raised (or a
strong term sheet) and/or first regulated-venue contract signed; appeals desk
operating; corpus licensing live.

**Development**
- **Appeals desk (Product C)**: human reviewer workflow with **COI
  attestations**, random assignment, append-only **signed** decisions on top of
  bundles.
- **`EvidenceRegistry.sol` on Base** — hash-anchor bundles, decisions, and daily
  audit-log heads (the stub exists).
- **Kalshi + Polymarket US ingestion** (rule edits + settlement delays are the
  contest signal there — no on-chain data).
- Corpus-licensing infrastructure + a precedent taxonomy.

**Marketing / BD**
- Land the **first regulated-venue contract** (listing gate + escalation desk) —
  pitch is regulatory ("an independent, audited resolution process"), not
  technical.
- **License the precedent corpus**; secure regulator/press citations.
- Seed the **acquirer relationships** — oracle networks (UMA/Chainlink) and
  neutral data firms, the buyers who *preserve* neutrality and therefore pay
  more than a single venue would.

**Legal / Corporate**
- **GmbH**; venue contracts with liability caps + indemnities; the reviewer COI
  framework made legally sound; clean IP/corpus ownership for diligence;
  data-protection at scale.

**Fundraising:** **close the seed** on the evidence.

**Team:** small team around the founder + co-founder; light governance.

---

## Cross-cutting tracks

**Critical path / dependencies**
1. Validated dataset → LLM extractor + calibration → **calibration page** (gates
   all commercial activity).
2. **Classification legal opinion** → monetization.
3. **UG** → any revenue or contract.
4. **Co-founder** → bandwidth to run product, GTM, and BD in parallel.
5. Track record + paying customers + venue pipeline → **seed**.

**Founding-moments checklist**
- [ ] Trademark "Prema" cleared (DPMA/EUIPO) + domain secured
- [ ] Impressum + privacy policy live
- [ ] UG (haftungsbeschränkt) formed; bank account; Steuerberater; Gewerbeanmeldung
- [ ] Classification legal opinion obtained
- [ ] Co-founder agreement (IP assignment, vesting, cap table) signed
- [ ] Business + pure-financial-loss insurance in force
- [ ] AGB / customer contracts + VAT/OSS set up before first invoice
- [ ] First € of revenue
- [ ] First venue contract
- [ ] Seed round closed (or strong term sheet)

**Budget trajectory**
- Phase 0–1: ~€0–150/month (free RPC tiers, Cloudflare free, one laptop). First
  real spend: LLM inference (Phase 1 extractor/adjudication) and legal fees
  (consult, UG formation, trademark). Ask the founder before any paid API/RPC
  upgrade or non-permissive dependency.

**Standing risks & the discipline**
- A venue builds in-house first → counter with **speed** and the cross-venue
  public record they structurally can't produce.
- Being publicly wrong early → confidence intervals + an open errata log (a
  feature no competitor with a legal department will copy).
- Regulatory classification → the load-bearing legal question; get the opinion.
- Free-tier RPC/API terms shift → provider-agnostic backfill already hedges it.
- Founder bandwidth → the co-founder hire is the unlock; automate all content
  (render, don't write).
- **The "don't-do" list** (speed discipline): no market operation, no positions,
  no custody, no token; no paid ads / SEO farming / conference booths before the
  calibration page; no fabricated metrics ever; no gold-plating over shipping the
  record.
