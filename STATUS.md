# STATUS — Prema, updated 2026-08-25

Durable project state: what exists, what is verified, and what is known broken.
**Read the newest file in `Handover/` first** — it carries what is in flight and
supersedes anything here that contradicts it. Companions: `TODO.md` (backlog),
`RECOVERY.md` (backfill plan), `docs/DECISIONS.md` (ADR-0001..0022),
`docs/DEPLOY.md` (the VPS runbook), `MARKETING.md` (go-to-market),
`docs/PLAN.md` (product scope).

## One-paragraph summary

Phase 0 infrastructure is complete and **the whole pipeline has now run end to
end on a Hetzner CPX22, not this laptop** — two thermal shutdowns killed local
runs, so the database was dumped and restored onto a VPS (`docs/DEPLOY.md`).
Both chain backfills are **complete**: Polygon 9,496,937 events to head
(92,626,114), Ethereum 4,141 events + 2,023,767 votes. The corpus is 2,615,958
markets, linted at `linter-v1.1.0` (5,670,580 hits), labelled (44,726
contested), exported, and **`validate` returns OK — the dispute sanity gate
passes** at 1,509 Jan–May 2026 disputes against a 1,000 threshold. Nothing has
been published.

**The measured picture, now at full scale:** listing-time text carries a real
but modest signal. `vague-source` — the rule the roadmap was gating on — came in
at **1.57x** stratified against `disputed` (1.61x in the top volume decile), not
the 2.02x measured on 21x fewer positives. Three independent methods now agree
on 1.4–1.6x: a blinded human-judgement study (1.46x matched), stratified rule
lift, and the full-corpus rerun. Uncontrolled numbers said 20x and were wrong.
This should stop being re-litigated. See ADR-0020 for the label-design problem
this exposed, and ADR-0022 for the memory failure that delayed it a day.

## Database (on the VPS — this laptop's copy is now behind)

| Table | Rows | Meaning |
|---|---:|---|
| `markets` | 2,615,958 | Gamma pass complete (both cursors `done: true`) |
| `rules_versions` | 2,615,958 | One listing-time (v1) row per market |
| `linter_hits` | 5,670,580 | Full corpus at `linter-v1.1.0` |
| `resolution_events` | 9,501,078 | **Complete** — Polygon + Ethereum both at head |
| `votes` | 2,023,767 | DVM votes, only 3,359 distinct request times |
| `disputes` | 4,127 | 2,566 joined to a market; 1,561 orphaned (P0) |
| `ambiguity_labels` | 2,615,958 | 44,726 contested · 42,709 `resolved_na` · 2,089 disputed · 6 escalated |
| `audit_log` | 31,000+ | Hash chain, verified intact |

**`contested` is currently just `resolved_na OR disputed`.** `escalated`
contributes 6 markets and `rules_edited_after_listing` zero (it needs the
recurring worker to have run for weeks). Do not describe the composite label as
four-component in any external material until that changes.

**Backups exist** (`../backups/*.dump`, ~850 MB total, 2026-08-24). No longer
single-copy. `linter_hits` and `rules_clauses` are deliberately excluded — they
regenerate deterministically in about an hour.

Rule fire rates across the corpus: `hedge-words` 57.3% · `no-na-condition`
40.9% · `vague-source` 9.5% · `deadline-no-timezone` 1.0% · `status-verb-gap`
0.8% · `occurrence-vs-reporting` 0.1% · `outcomes-not-exhaustive` **0.0%**
(unreachable: every market is binary, so its `<= 2 outcomes` guard always
returns early — see the note in `packages/linter/src/index.ts`).

**The sanity gate passes.** 4,127 `DisputePrice` events total, **1,509 in
Jan–May 2026** against the ~1,000 threshold `TODO.md` set. `validate` returns
`RESULT: OK`.

**The MOOv2 question is answered: disputes are suppressed, not eliminated.**
The ADR-0014 probe window saw zero `DisputePrice` on the managed oracle, and
that was simply rarity as suspected — the full scan finds **2,350 MOOv2
disputes** spanning 2025-08-25 to 2026-08-25:

| Oracle | Proposals | Disputes | Rate |
|---|---:|---:|---:|
| `oov2` | 162,617 | 1,777 | 1.093% |
| `moov2` | 1,797,469 | 2,350 | **0.131%** |

An **8.4x collapse** after the 2025-09-05 proposer whitelist, closely matching
the 0.113% the external research predicted. So the `requester`-filtered OO query
is fine and MOOv2 does not route disputes through a different event. Nothing is
broken; the label is just scarcer per market than pre-2025 history implies, and
**any rate quoted across the 2025-09-05 break is a blend of two populations.**

**Both chain cursors exist and are at head.** `chain:polygon:lastBlock` is
92,626,114; Ethereum is complete through 25,830,831. The "poisoned checkpoint"
scenario in `RECOVERY.md` §0.1 is historical — re-running an indexer now resumes
from head and does nothing, which is correct. Events still dedupe on
`(chain, tx_hash, log_index)`, so re-scanning any range remains a safe no-op.

## The checksum fix — committed and pushed 2026-08-23

These changes are the difference between a correct backfill and a silently
empty one. Full reasoning in **ADR-0014**. Verified green
(`pnpm lint && pnpm typecheck && pnpm test`, 56/56) and on `origin/main` — a
re-scan from this tree is safe.

- `apps/workers/src/chain/config.ts` — rewrites `ctfAdapterV4`,
  `negRiskAdapterV4` and `umaSportsOracle` as EIP-55 checksummed literals.
- `apps/workers/test/chain.test.ts` — regression guard asserting every address
  in `POLYGON_CONTRACTS` + `ETHEREUM_CONTRACTS` is checksummed.
- `docs/DECISIONS.md` — ADR-0014 itself.
- `TODO.md` — MOOv2 marked answered.
- `vitest.config.ts` — `hookTimeout: 30_000` (PGlite boot was flaking).

**Why this is the most important thing in this file.** viem validates the
checksum on a mixed-case address and throws `Address ... is invalid`. The V4
literals added in ADR-0012 were mis-cased, and the failure was
**asymmetric**: `getLogs` lowercases the adapter list first and kept working
perfectly, while every `readContract` threw. The only `readContract` in the
codebase is `optimisticOracle()`, and `resolveManagedOracle()` caught the
throw, logged a warning, and returned `null` — so the indexer queried plain
OOv2 only.

Measured cost, from ADR-0014: a 20k-block probe captured 17,699 V4 adapter
events and **zero** OO events. After the casing fix the same window yields
8,430 `ProposePrice` + 6,881 `Settle` on the managed oracle. The V4 adapters
resolve ~72% of the corpus, so **a full backfill run against HEAD would have
recorded no proposals, no settlements and no disputes for ~1.88M markets** —
the composite label's primary signal, silently empty, after ~3 days of
credits.

**Therefore: commit and push this before triggering the re-scan in
`RECOVERY.md` §0.3.** Backed up to `../backups/` on 2026-08-24 and restored
onto the VPS; no longer a single copy.

## Dev machine state (Windows 10, this laptop)

- Node **v22.17.0** ✓ · pnpm **10.34.5** ✓ · git 2.49 ✓ (pnpm installed via
  `npm i -g pnpm`; **corepack is blocked** — EPERM writing to Program Files,
  don't retry it)
- **Docker 29.7.2, installed and running.** Compose stack up ~10h:
  `verdict-postgres-1` (healthy), `verdict-redis-1`, `verdict-minio-1`.
  The CLI is a per-user install and **not on PATH by default** —
  `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe`.
- Postgres is the live database. The old PGlite demo DB still exists at
  `.pglite/verdict/` (96 MB, gitignored) — stale, safe to delete.
- `data/exports/*.csv|parquet` are **stale**, dated 2026-08-22, from the
  capped demo run. Do not read numbers off them.
- Python **3.9.13** only — `/eval` targets 3.12 and has never run here.
- **`gh` CLI is not installed**, so remote CI status could not be verified
  from this machine. CI is armed but unconfirmed.

## Component status

| Path | State | Notes |
|---|---|---|
| `packages/schema` | done | 12 tables, migration `0000_unique_genesis.sql`, dual-driver `createDb` (postgres/pglite), audit hash chain (`appendAudit`/`verifyAuditChain`) |
| `packages/linter` | done (v1) | 7 data-driven rules, word lists in `src/wordlists.json`; vendored verbatim into the marketing site (see below) |
| `apps/workers` | done | Gamma keyset ingest, Polygon+Ethereum indexers, label job, CLOB snapshots, BullMQ worker; `ingest:chain --reset-cursor` (ADR-0013); V4 adapters (ADR-0012) |
| `data` | done | `dataset:build` orchestrator, CSV+Parquet exporters, REPORT.md generator with sanity gate, **post-build validator** (`pnpm --filter @verdict/data run validate`), dispute post-mortem generator |
| `apps/api` | stub+ | `/health`, `/v1/markets/:id` (market+label+linter hits+disclaimer), tested; no graceful shutdown yet |
| `packages/llm` | stub | Contract pinned: zod structured outputs, cost metering, `model_version` = model id + prompt hash. No calls made yet |
| `packages/retrieval` | stub | `publishedBefore` guard is real and tested; search/snapshotter are Phase 2 |
| `contracts/` | stub | Foundry layout + EvidenceRegistry placeholder; not in CI |
| `eval/` | stub | Time split HARD-CODED in `src/verdict_eval/split.py` + tests; backtest raises NotImplemented; needs Python 3.12 |

## The marketing site is a separate repo

`c:\Users\Linus\Desktop\prema\prema-web` — its own git repo, deliberately not
a member of this pnpm workspace, built from `docs/WEBSITE_BRIEF.md`. **Neither
repo references the other**, so this pointer is the only link between them.

Two things that bind across the boundary:

- It **vendors this repo's linter verbatim** (`packages/linter/src/index.ts` +
  `wordlists.json` → `prema-web/src/lib/`), pinned at `linter-v1.0.0`, so the
  demo on the site runs production code. It is a copy and can drift;
  `prema-web/src/lib/linter.test.ts` is the drift alarm. Verified identical on
  2026-08-23.
- The site publishes **no Prema accuracy numbers, dispute counts or
  calibration charts** until the public dataset ships. Its dataset-fed pages
  render an honest "launches with the public dataset" state instead, and CI
  there fails the build if fixture data reaches `dist/`.

## Verified external facts (verified 2026-08-22 unless noted — re-verify if stale)

**Gamma API** (fixtures in `data/fixtures/`):
- `GET https://gamma-api.polymarket.com/markets/keyset?limit=100&order=id&ascending=true&closed=true&include_tag=true[&after_cursor=…]`
  → `{ "markets": [...], "next_cursor"?: "..." }`; `next_cursor` absent on last
  page; limit max 100; **`offset` returns HTTP 422** (old `/markets` still
  answers but was deprecated May 1 2026 — do not build on it).
- The cursor is opaque and bound to the query shape (embeds an `oh` hash) —
  resume MUST reuse identical params. Cursors are stored in `ingest_state`
  keyed `gamma:markets:{closed|open}[:desc]:cursor`. Both now read
  `done: true`.
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

**Contracts** (sources named in `apps/workers/src/chain/config.ts` comments).
**Store every address EIP-55 checksummed** (ADR-0014) — a test pins it. Not
cosmetic: viem rejects a bad-checksum literal on `readContract` while `getLogs`
lowercases and keeps working, which hid MOOv2 for a day.
- Polygon: UmaCtfAdapter v1 `0xCB1822859cEF82Cd2Eb4E6276C7916e692995130`,
  v2 `0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74`,
  v3 `0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49`,
  NegRisk UmaCtfAdapter `0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d`,
  ConditionalTokens `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`,
  OptimisticOracleV2 `0xeE3Afe347D5C74317041E2618C49534dAf887c24`.
- **V4 adapters (added 2026-08-23, ADR-0012)** — verified via Polygonscan
  public name tags, cited in `config.ts`: `ctfAdapterV4`
  `0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7`, `negRiskAdapterV4`
  `0x69c47De9D4D3Dad79590d61b9e05918E03775f24`. Together these resolve
  ~1.88M of 2.62M markets — the bulk of the ambiguous tail. The dead Polygon
  sweep predates them, which is why a resume is not enough.
- `umaSportsOracle` `0xb21182d0494521Cf45DbbeEbb5A3ACAAb6d22093` — ~5.7k
  multi-outcome sports markets on the `MULTIPLE_VALUES` identifier, a
  different event path from `YES_OR_NO_QUERY`. **Deferred** (ADR-0012).
- Ethereum: VotingV2 `0x004395edb43EFca9885CEdad51EC9fAf93Bd34ac`.
- **MOOv2: ANSWERED 2026-08-23 (ADR-0014). It is live, behind V4.** Both V4
  adapters return `0x2C0367a9DB231dDeBd88a94b4f6461a6e47C58B1` from
  `optimisticOracle()`; `ctfAdapterV3`, the old NegRisk adapter and
  `umaSportsOracle` all still return plain OOv2. This **supersedes** the
  earlier finding here that MOOv2 appeared not to be live — that conclusion
  came from pre-V4 adapters plus the checksum bug above. The address appears
  in no UMA doc or repo; it is read off-chain from the adapter's public
  immutable, which is a stronger source than documentation.
  **Leave `MOOV2_ADDRESS` unset** — `resolveManagedOracle()` resolves it at
  runtime, and an env pin would go stale on the next adapter generation,
  which is exactly how this was missed.
- Join rule (verified in `UmaCtfAdapter.sol` line 116 and confirmed on live
  events): `questionID = keccak256(ancillaryData-as-sent-to-OO)`. Adapter/CTF
  events carry questionID in topics; OO events get it derived.
- Event signatures in `config.ts` were quoted from contract source
  (IUmaCtfAdapter.sol, OptimisticOracleV2Interface.sol, ConditionalTokens.sol,
  VotingV2.sol) — not from memory. Adapter v1 (2021) may emit different
  shapes; decode failures there are tolerated.

**RPC landscape (ADR-0002, verified from official docs 2026-08-22):**
- Alchemy free: 30M CU/mo BUT `eth_getLogs` capped at **10 blocks/request** →
  unusable for backfill, fine for head-tailing. **Removed from the deep-sweep
  transport entirely** (ADR-0013) after it thrashed with "JSON is not a valid
  request object"; it remains a fallback for live head-tailing only.
- QuickNode free: getLogs capped at **5 blocks** → unusable.
- **Infura/MetaMask Developer Core (free): PRIMARY.** 3M credits/day,
  getLogs=255 credits, and getLogs accepts *any* block range as long as the
  response stays ≤10k logs (or 2k blocks unlimited). This is the only
  verified free path for the 2024→now Polygon backfill (~40M blocks).
  A full sweep ≈ **~8M credits ≈ ~3 free-tier days**, resumable across days
  at no extra cost.
- PublicNode (keyless): works for recent windows; deep history behind their
  archive upgrade; range violations surface as bare InvalidParams errors.
- Env wiring: `POLYGON_RPC_URL`, `ETHEREUM_RPC_URL` (+`_FALLBACK` variants)
  via viem `fallback()` transport; bare keys expand to provider URLs and
  `.env` is loaded by `loadEnv()` (ADR-0011). No provider SDKs anywhere.

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
- **EIP-55 casing** on every contract address literal (above). Pinned by a
  test in `apps/workers/test/chain.test.ts`.

## Gotchas that cost time (don't rediscover)

- **Mis-cased contract addresses fail silently in one direction only** —
  `readContract` throws, `getLogs` works. Cost a day of MOOv2 investigation.
- PowerShell 5.1: `Get-Content` defaults to ANSI — always `-Encoding utf8`
  when reading fixtures (mojibake otherwise). Double quotes inside `git
  commit -m @'…'@` here-strings break native arg quoting — avoid `"` in
  commit messages. `&&` doesn't exist in PS 5.1.
- Docker CLI is not on PATH (per-user install) — use the full
  `%LOCALAPPDATA%` path above, or `docker.exe` won't be found.
- tsx: a `.ts` script outside a `"type":"module"` package fails with
  ERR_REQUIRE_ASYNC_MODULE on top-level await → use `.mts` or keep scripts
  inside packages. Node resolves imports from the *script's* dir — scratch
  scripts must live inside the workspace to see `@verdict/*`.
- Scratch scripts also break `pnpm lint` (`no-console`). Delete them when
  done or keep them out of the workspace.
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
pnpm lint && pnpm typecheck && pnpm test     # 97/97 across 12 files (2026-08-25)
pnpm db:migrate                              # needs DATABASE_URL
pnpm dataset:build                           # full run; caps via DATASET_* envs
pnpm --filter @verdict/data run validate     # sanity gate; run BEFORE trusting numbers
```

Git: 20 commits on `main`, HEAD `d8d9b36`, remote `origin` =
github.com/linussssssss/prema. CI workflow exists
(`.github/workflows/ci.yml`); its status on the remote could not be checked
from this machine (`gh` not installed).

## Standing risks (watch continuously)

1. **The working tree is dirty and unpushed** — the V4 checksum fix, ADR-0014
   and the MOOv2 answer exist only on this laptop. Commit and push before the
   re-scan; a re-scan without them burns ~3 days of credits on a dataset with
   no disputes for ~72% of markets.
2. Escalation-join heuristic can mislabel `escalated` (ADR-0008) — refine
   before any public number.
3. Free-tier RPC terms shift without notice — the backfill layer is
   provider-agnostic on purpose; if Infura's getLogs rule changes, Envio
   HyperSync or one paid Alchemy month are the escape hatches (ask founder —
   money/new dependency).
4. `rules_edited_after_listing` is right-censored for pre-crawl closes, and
   will read **~0** off a one-pass crawl because each market is seen once and
   only v1 is stored. Needs the re-poll worker running over time; ancillary
   reconstruction (TODO P1) shrinks but doesn't eliminate it. Disclose in any
   published methodology.
5. Speed matters more than polish (in-house build threat, PLAN §constraints)
   — the 90-day target is the public calibration page, not infrastructure.
