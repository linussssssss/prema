# Decisions (ADR log)

One entry per technical decision not already fixed in `docs/PLAN.md`.
Format: date, decision, alternatives, why. Append-only; supersede with a new
entry rather than editing an old one.

---

## ADR-0001 — Seed docs/PLAN.md from the founding brief (2026-08-22)

**Decision:** No standalone plan document existed, so `docs/PLAN.md` was
written from the founding message (v0) and is now the product source of truth.
**Alternatives:** leave PLAN.md absent until the founder writes one.
**Why:** CLAUDE.md and future sessions need a stable reference; the founding
message would otherwise live only in one chat transcript.

---

## ADR-0002 — RPC providers: Infura primary, Alchemy secondary (2026-08-22)

**Decision:** Chain access via env-configured URLs only (no provider SDKs).
Primary for backfill + serving: Infura/MetaMask Developer Core (free) — 3M
credits/day, `eth_getLogs` = 255 credits, and getLogs accepts either a
2,000-block range with unlimited response or **any** block range capped at 10k
logs returned. Secondary (viem `fallback()` transport + live head-polling):
Alchemy free tier (30M CU/month) — its getLogs is capped at 10 blocks/request
on free, fine for tailing, useless for backfill. Keyless emergency fallback
for recent blocks: PublicNode.
**Alternatives:** Alchemy-only (free getLogs cap 10 blocks → backfill would
cost ~300M CU/month, 10× the allowance); QuickNode free (getLogs cap 5
blocks); dRPC (limits unverifiable from docs at decision time); Envio
HyperSync (fast but niche dependency — revisit if backfill is too slow);
paid plans (ask founder first).
**Why:** verified Aug 2026 that free tiers have clamped getLogs ranges;
Infura's 10k-logs-any-range rule is the only verified free path for a
2024→now Polygon backfill. Backfill layer does adaptive range bisection +
backoff regardless of provider, so switching is a `.env` edit.

---

## ADR-0003 — PGlite for tests and Docker-less demo runs (2026-08-22)

**Decision:** `DATABASE_URL=pglite://<dir>` runs the identical Drizzle schema
on in-process Postgres (PGlite, Apache-2.0). Used by vitest and by dataset
runs on machines without Docker. The real stack stays Postgres 16 + pgvector
via docker compose; migrations are identical for both.
**Alternatives:** testcontainers (needs Docker — not installed on the dev
machine at project start); mocking the DB (tests would lie).
**Why:** lets the full pipeline run and be tested end-to-end today; CI needs
no services.

---

## ADR-0004 — Market identity and dataset lower bound (2026-08-22)

**Decision:** Internal market key = Gamma market `id` (venue-scoped, unique
`(venue_id, external_id)`). "Since 2024-01-01" means markets *created* on or
after 2024-01-01 UTC (Gamma `createdAt`). On-chain rows join via
`condition_id`/`question_id`.
**Alternatives:** key by conditionId (missing for some pre-listing rows); "in
2024+" = resolved after 2024 (would truncate rules-edit history for markets
listed earlier).
**Why:** created-at is the listing-time viewpoint the ambiguity score will
operate at; no hindsight in the cut.

---

## ADR-0005 — dataset:build is a sequential in-process pipeline (2026-08-22)

**Decision:** `pnpm dataset:build` runs ingestion → indexing → labeling →
export as ordered in-process steps (idempotent upserts, resumable). BullMQ is
used only for recurring jobs (hourly CLOB snapshots, open-market rules
re-polls), not for the rebuild.
**Alternatives:** everything through BullMQ queues.
**Why:** determinism and "one command rebuilds the dataset from scratch"
matter more in Phase 0 than throughput; queues add failure modes to a batch
job that doesn't need them.
