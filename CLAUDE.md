# CLAUDE.md — Verdict

`docs/PLAN.md` is the source of truth for product scope. `docs/DECISIONS.md`
is the ADR log for technical decisions — add an entry when you make one, as
you go, not at the end.

**Start every session by reading `STATUS.md`** (full project state, verified
external facts, environment quirks) **and `TODO.md`** (prioritized backlog
with per-item context). Keep both current: update STATUS.md when reality
changes, check items off in TODO.md as they land.

## Non-negotiables (company-defining; never trade these away)

- We never operate a market, take positions, hold customer funds/keys, or
  issue a token.
- Neutrality is enforced in code and process: COI attestations per case,
  random reviewer assignment, append-only logs.
- No hindsight leakage, ever: **all retrieval takes `published_before` and
  refuses to run without it**; backtests use the fixed time split below.
- Everything decision-relevant is append-only and hashed. **Never `UPDATE`
  decision-relevant rows** (rules_versions, scores, labels, bundles,
  decisions, audit_log) — append a new version.
- Model outputs are "recommended outcome, not a ruling". Never present a
  model verdict as fact.

## Fixed stack (don't relitigate; changes need founder sign-off)

- pnpm monorepo, TypeScript, Node 22, strict mode, ESM.
- API: Fastify. Jobs: BullMQ on Redis. DB: Postgres 16 + pgvector via Drizzle
  ORM, migrations checked in (`packages/schema/migrations`).
- Chain: viem; RPC URLs from env only (ADR-0002). Backfill = `getLogs` in
  bounded ranges with adaptive bisection; live = polling, no websockets.
- Object storage: S3-compatible (MinIO in compose, R2 later).
- All LLM calls via `packages/llm`: zod-structured outputs, per-call cost
  metering, `model_version` (model id + prompt hash) stored with every output.
- Python 3.12 only inside `/eval`; never in the serving path.
- Contracts: Foundry in `contracts/`, Base Sepolia for tests.
- Secrets only via `.env` (gitignored); `.env.example` is committed.

## Time split (hard-coded in /eval; do not move it)

train ≤ 2025-12-31 · validate 2026-01-01→2026-06-30 · test rolling monthly after.

## Conventions & pitfalls

- Every stored fact has `occurred_at` (when it happened on-chain/at venue)
  and `captured_at` (when we saw it). Don't conflate them.
- Idempotent upserts keyed on external ids; on-chain rows unique on
  `(chain, tx_hash, log_index)`. Re-running any ingest step must be safe.
- `audit_log` is a hash chain (`prev_hash`, `row_hash`) — only append through
  the helper in `packages/schema`, never with raw inserts.
- Composite label: `contested = disputed OR escalated OR resolved_na OR
  rules_edited_after_listing`; `price_reversal`/`manual_flag` are auxiliary,
  never part of the target.
- Gamma API is cursor-paginated (since Apr 2026); offset endpoints are
  deprecated. Never write an API client from memory — verify against live
  responses and record fixtures in `data/fixtures/`.
- On-chain data is the primary source; venue APIs are convenience. MOOv2
  suppresses disputes, so raw "disputed" is sparse and biased — that's why the
  composite label exists.
- Rate-limit and back off politely on public APIs; respect ToS.
- Never fabricate data to complete a report — `data/REPORT.md` must state
  explicitly when an indexer is incomplete.
- Logs to stdout as JSON (pino); no stray print debugging.
- Small commits, conventional messages, one PR-sized chunk per deliverable.
- `DATABASE_URL=pglite://<dir>` runs the same schema without Docker
  (tests/demo only — ADR-0003).

## Before reporting anything as done

```
pnpm lint && pnpm typecheck && pnpm test
```

## Founder interaction rules

- Ask before: spending money, adding a non-permissively-licensed dependency,
  or changing a fixed decision. Don't ask about things resolvable by reading
  docs or running code.
- On product ambiguity: make a reasonable call, record it in DECISIONS.md,
  flag it in the summary.
