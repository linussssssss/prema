# Verdict

Verdict is the neutral resolution layer for the ambiguous tail of prediction
markets: it scores dispute risk in market rules at listing time, assembles
evidence and precedent when markets are contested, and anchors every decision
in an auditable, append-only record. Phase 0 builds the foundation — a
complete, labeled dataset of every Polymarket resolution since 2024 and a
deterministic rules-text linter. See `docs/PLAN.md` for scope and
`docs/DECISIONS.md` for technical decisions.

## Run it

```bash
docker compose up -d          # Postgres 16 + pgvector, Redis, MinIO
cp .env.example .env          # fill in RPC keys (see ADR-0002)
pnpm install
pnpm db:migrate
pnpm dataset:build            # rebuilds the full dataset → data/exports/ + data/REPORT.md
pnpm lint && pnpm typecheck && pnpm test
```

Without Docker (tests/demo): set `DATABASE_URL=pglite://./.pglite/verdict`.

## Rebuild the dataset

`pnpm dataset:build` is idempotent and resumable: Gamma market ingestion →
on-chain indexers (Polygon CTF Adapter / OOv2 / MOOv2 / CTF, Ethereum
VotingV2) → composite `contested` labels → linter over all rules versions →
Parquet + CSV exports and a generated `data/REPORT.md` with dataset counts.
