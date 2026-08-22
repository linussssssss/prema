# STATUS — Verdict, end of founding session (2026-08-22)

Snapshot of everything that exists, everything verified, and everything known
to be broken or missing. Written to make any future session (any model, or a
human alone) productive within minutes. Companion file: `TODO.md` (what to do
next, in priority order). Product scope: `docs/PLAN.md`. Technical decisions:
`docs/DECISIONS.md` (ADR-0001..0010). Conventions: `CLAUDE.md`.

## One-paragraph summary

Phase 0 is functionally complete but has only run in capped demo mode: one
command (`pnpm dataset:build`) rebuilds a labeled dataset of Polymarket
markets with append-only rules versions, on-chain resolution/dispute events,
the composite `contested` label, seven-rule linter output, CSV+Parquet
exports, and a generated `data/REPORT.md` that states its own gaps. The full
2024→now backfill has NOT run yet — it is blocked on two free RPC keys (and
ideally Docker). Quality gate is green: `pnpm lint && pnpm typecheck &&
pnpm test` → 44/44 tests. Six commits on `main`, no remote configured.

## Dev machine state (Windows 10, this laptop)

- Node v22.17.0 ✓ · git 2.49 ✓ · pnpm 10.34.5 (installed via `npm i -g pnpm`;
  **corepack is blocked** — EPERM writing to Program Files, don't retry it)
- **Docker: NOT INSTALLED.** The compose stack has never been started.
  Everything so far ran on PGlite (`DATABASE_URL=pglite://<abs-path>`).
- Python 3.9 only — `/eval` targets 3.12 and has never been executed here.
- Demo database exists at `.pglite/verdict/` (gitignored) with the 6,000-market
  demo slice. Safe to delete; rebuildable.
- pnpm printed an "ignored build scripts" notice at install; nothing needed
  approval so far. If a native dep misbehaves: `pnpm approve-builds`.

## What ran live tonight (capped demo, real data)

Command:
```
DATABASE_URL=pglite://<repo>/.pglite/verdict  DATASET_MAX_PAGES=30
DATASET_MAX_BLOCKS=50000  DATASET_NEWEST_FIRST=1  DATASET_CHAIN_FROM_RECENT=1
pnpm dataset:build
```
Results: 6,000 markets (3,000 newest closed + 3,000 newest open, all ≥2024),
6,000 rules versions, 14,683 linter hits, 6,000 labels (30 contested — all
resolved-N/A; the slice is Aug-2026 sports/crypto so the political rules
barely fire), 8 real Polygon oracle events indexed in a 50k-block head window
(incl. a ProposePrice→Settle pair whose keccak-derived questionId matched —
the join mechanism works), audit chain verified intact (62 rows), exports +
REPORT.md written, exit 0. Ethereum leg failed on PublicNode's InvalidParams
range error; the shrink heuristic was widened afterwards (commit 28efb32) but
has not been re-run against PublicNode since.

## Component status

| Path | State | Notes |
|---|---|---|
| `packages/schema` | done | 12 tables, migration `0000_unique_genesis.sql`, dual-driver `createDb` (postgres/pglite), audit hash chain (`appendAudit`/`verifyAuditChain`) |
| `packages/linter` | done (v1) | 7 data-driven rules, word lists in `src/wordlists.json`, 22 tests incl. real 2020/2021 market fixtures tripping both canonical patterns |
| `apps/workers` | done | Gamma keyset ingest, Polygon+Ethereum indexers, label job, CLOB snapshots, BullMQ worker, CLIs (`pnpm --filter @verdict/workers run ingest:polymarket` etc.) |
| `data` | done | `dataset:build` orchestrator, CSV+Parquet exporters, REPORT.md generator with honesty section + sanity gate |
| `apps/api` | stub+ | `/health`, `/v1/markets/:id` (market+label+linter hits+disclaimer), tested |
| `packages/llm` | stub | Contract pinned: zod structured outputs, cost metering, `model_version` = model id + prompt hash. No calls made in Phase 0 |
| `packages/retrieval` | stub | `publishedBefore` guard is real and tested; search/snapshotter are Phase 2 |
| `contracts/` | stub | Foundry layout + EvidenceRegistry placeholder; not in CI |
| `eval/` | stub | Time split HARD-CODED in `src/verdict_eval/split.py` + tests; backtest raises NotImplemented |

## Verified external facts (all verified 2026-08-22 — re-verify if stale)

**Gamma API** (fixtures in `data/fixtures/`):
- `GET https://gamma-api.polymarket.com/markets/keyset?limit=100&order=id&ascending=true&closed=true&include_tag=true[&after_cursor=…]`
  → `{ "markets": [...], "next_cursor"?: "..." }`; `next_cursor` absent on last
  page; limit max 100; **`offset` returns HTTP 422** (old `/markets` still
  answers but was deprecated May 1 2026 — do not build on it).
- The cursor is opaque and bound to the query shape (embeds an `oh` hash) —
  resume MUST reuse identical params. Cursors are stored in `ingest_state`
  keyed `gamma:markets:{closed|open}[:desc]:cursor`.
- **No server-side createdAt filter.** `start_date_min` is unusable: old rows
  carry bogus recent startDates (2021 market → startDate 2026-04-10). We
  paginate everything and cut client-side on `createdAt ≥ 2024-01-01`.
- `closed=true` reaches back to id 12 (2020); omitting `closed` returns open
  markets only. Arrays (`outcomes`, `outcomePrices`, `clobTokenIds`,
  `umaResolutionStatuses`) arrive as **stringified JSON**. Old markets have a
  flat `category`; new ones need tags (via `include_tag=true`) — parser
  handles both. `resolvedBy` = the adapter address that resolves the market.
- Volume/liquidity: use `volumeNum`/`liquidityNum` (numbers), fall back to
  string fields.

**CLOB API** (fixtures recorded): `GET https://clob.polymarket.com/book?token_id=…`
(bids/asks/timestamp-ms/hash), `/midpoint`, `/spread`,
`/prices-history?market=<clobTokenId>&interval=1w&fidelity=720` → `{history:[{t,p}]}`
(t = epoch seconds). All keyless.

**Contracts** (sources named in `apps/workers/src/chain/config.ts` comments):
- Polygon: UmaCtfAdapter v1 `0xCB1822859cEF82Cd2Eb4E6276C7916e692995130`,
  v2 `0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74`,
  v3 `0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49`,
  NegRisk UmaCtfAdapter `0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d`,
  ConditionalTokens `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`,
  OptimisticOracleV2 `0xeE3Afe347D5C74317041E2618C49534dAf887c24`.
- Ethereum: VotingV2 `0x004395edb43EFca9885CEdad51EC9fAf93Bd34ac`.
- **ManagedOOv2 (MOOv2): NO published address found anywhere** (UMA docs,
  repos, UMIP-189 text all lack it). Resolved at runtime via the adapters'
  public `optimisticOracle()` getter; `MOOV2_ADDRESS` env pins it manually.
- **Key finding: on 2026-08-22, adapter v3 AND the NegRisk adapter both
  returned plain OOv2 from `optimisticOracle()`, and live proposals that day
  ran through OOv2.** Either the MOOv2 migration lags the announcements, or it
  runs through an adapter version we haven't enumerated. See TODO.
- Join rule (verified in `UmaCtfAdapter.sol` line 116 and confirmed on live
  events): `questionID = keccak256(ancillaryData-as-sent-to-OO)`. Adapter/CTF
  events carry questionID in topics; OO events get it derived.
- Event signatures in `config.ts` were quoted from contract source
  (IUmaCtfAdapter.sol, OptimisticOracleV2Interface.sol, ConditionalTokens.sol,
  VotingV2.sol) — not from memory. Adapter v1 (2021) may emit different
  shapes; decode failures there are tolerated.

**RPC landscape (ADR-0002, verified from official docs 2026-08-22):**
- Alchemy free: 30M CU/mo BUT `eth_getLogs` capped at **10 blocks/request** →
  unusable for backfill, fine for head-tailing. Secondary/fallback.
- QuickNode free: getLogs capped at **5 blocks** → unusable.
- **Infura/MetaMask Developer Core (free): PRIMARY.** 3M credits/day,
  getLogs=255 credits, and getLogs accepts *any* block range as long as the
  response stays ≤10k logs (or 2k blocks unlimited). This is the only
  verified free path for the 2024→now Polygon backfill (~40M blocks).
- PublicNode (keyless): works for recent windows; deep history behind their
  archive upgrade; range violations surface as bare InvalidParams errors.
- Env wiring: `POLYGON_RPC_URL`, `ETHEREUM_RPC_URL` (+`_FALLBACK` variants)
  via viem `fallback()` transport. No provider SDKs anywhere.

## Mechanisms a future session must not break

- **Append-only** (CLAUDE.md non-negotiable): `rules_versions`,
  `ambiguity_labels`, `audit_log` are never UPDATEd. Labels dedupe by
  fingerprint before appending. `audit_log` only via `appendAudit()`
  (advisory-lock-serialized hash chain; `verifyAuditChain()` checks it).
- **Rules hashing** (ADR-0006): `rulesTextHash()` normalizes (CRLF, trailing
  ws, blank-line collapse) so cosmetic churn ≠ a rules edit. Raw text stored.
- **Composite label**: `contested = disputed ∨ escalated ∨ resolved_na ∨
  rules_edited_after_listing`; `price_reversal`/`manual_flag` auxiliary only.
- **Escalation join** (ADR-0008): OO request timestamp ∈ DVM request times
  (YES_OR_NO_QUERY-filtered). Known-imperfect; refine before anything public.
- **Adaptive getLogs** (`forEachAdaptiveRange`): halve span on provider range
  errors, grow 1.5× on success; block times interpolated per chunk (ADR-0007).
- **Occurred/captured discipline**: every fact row has both. Retrieval takes
  `publishedBefore` and throws without it (already enforced in the stub).
- **Idempotency**: markets upsert on id; events unique (chain, tx, logIndex);
  crawls resume from `ingest_state`. Any step can re-run safely.

## Gotchas that cost time tonight (don't rediscover)

- PowerShell 5.1: `Get-Content` defaults to ANSI — always `-Encoding utf8`
  when reading fixtures (mojibake otherwise). Double quotes inside `git
  commit -m @'…'@` here-strings break native arg quoting — avoid `"` in
  commit messages. `&&` doesn't exist in PS 5.1.
- tsx: a `.ts` script outside a `"type":"module"` package fails with
  ERR_REQUIRE_ASYNC_MODULE on top-level await → use `.mts` or keep scripts
  inside packages. Node resolves imports from the *script's* dir — scratch
  scripts must live inside the workspace to see `@verdict/*`.
- pnpm strict node_modules: every package must declare `drizzle-orm` (etc.)
  itself; transitive access fails at runtime/typecheck.
- Stateful `/g` regexes shared across calls caused a real linter bug (fixed:
  factory per use). exactOptionalPropertyTypes: pino needs `base: null`.
- PGlite can't mkdir nested dirs — `createDb` now does `mkdirSync(recursive)`
  and resolves relative paths against cwd (prefer absolute in env).
- Monorepo runs from repo root; `pnpm --filter` changes cwd for the child.

## Quality gate / repro

```
pnpm install
pnpm lint && pnpm typecheck && pnpm test     # 44/44 green as of 28efb32
pnpm db:migrate                              # needs DATABASE_URL
pnpm dataset:build                           # full run; caps via DATASET_* envs
```
Git: 6 commits on `main`, **no remote yet**. CI workflow exists
(`.github/workflows/ci.yml`) but has never run (no GitHub repo).
