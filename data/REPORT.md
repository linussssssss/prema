# Verdict dataset report

Generated: 2026-08-22T20:58:38.937Z · driver: pglite · started: 2026-08-22T20:56:54.156Z

## Build status

- **migrate**: ok — schema up to date (pglite)
- **ingest-gamma**: partial — 6000 markets upserted, 6000 rules versions, 60 pages (capped at 30/pass), 0 pre-2024 skipped
- **index-polygon**: partial — blocks 92434521–92484521, 8 events, managed oracle: not found (capped run — history NOT fully indexed)
- **index-ethereum**: failed — InvalidParamsRpcError: Invalid parameters were provided to the RPC method.
Double check you have provided the correct parameters.

URL: https://ethereum-rpc.publicnode.com
Request body: {"method":"eth_getLogs","params":[{"address":"0x004395edb43EFca9885CEdad51EC9fAf93Bd34ac","topics":["0x4bd654e0f2f
- **linter**: ok — 6000 versions linted (+0 already done), 14683 hits stored
- **labels**: ok — 6000 markets labeled, 30 contested, 0 dispute records
- **export**: ok — markets.csv, markets.parquet, disputes.csv, rules_versions.csv, linter_hits.csv

> **This dataset is INCOMPLETE.** Steps not fully run: ingest-gamma, index-polygon, index-ethereum. Counts below describe only what was ingested; nothing has been extrapolated.

Caps in effect: {"DATASET_MAX_PAGES":"30","DATASET_MAX_BLOCKS":"50000"}

## Sanity check

NOT EVALUATED — on-chain indexing incomplete (see Build status); the 0 disputes currently stored are a lower bound, not the dataset.

## Dataset counts

| metric | count |
|---|---|
| markets (created ≥ 2024-01-01) | 6000 |
| closed | 3000 |
| open | 3000 |
| labeled | 6000 |
| disputed | 0 |
| escalated (DVM vote) | 0 |
| resolved N/A (50-50) | 30 |
| rules edited after listing | 0 |
| **contested (composite)** | **30** (0.5% of labeled) |
| dispute records (oracle requests) | 0 |

## Value at stake

- Total volume, all markets: $7,958,674
- Volume on contested markets: $4,655 (0.1%)

## Markets by month (listed_at)

| month | markets | contested | rate |
|---|---|---|---|
| 2026-08 | 6000 | 30 | 0.5% |

## Markets by category (top 15)

| category | markets | contested | rate |
|---|---|---|---|
| Sports | 4433 | 7 | 0.2% |
| Bitcoin | 500 | 0 | 0.0% |
| Ethereum | 400 | 0 | 0.0% |
| Up or Down | 320 | 0 | 0.0% |
| Esports | 235 | 23 | 9.8% |
| Tennis | 90 | 0 | 0.0% |
| Crypto | 22 | 0 | 0.0% |

## Linter hit rates (latest rules version per market)

| rule | hit rate (all) | P(hit \| contested) | P(hit \| not contested) | lift |
|---|---|---|---|---|
| hedge-words | 79.0% | 93.3% | 78.9% | 1.18 |
| deadline-no-timezone | 0.0% | 0.0% | 0.0% | n/a |
| occurrence-vs-reporting | 0.8% | 0.0% | 0.8% | 0.00 |
| status-verb-gap | 0.0% | 0.0% | 0.0% | n/a |
| vague-source | 16.0% | 0.0% | 16.1% | 0.00 |
| outcomes-not-exhaustive | 0.0% | 0.0% | 0.0% | n/a |
| no-na-condition | 20.7% | 0.0% | 20.8% | 0.00 |

### Canonical-pattern examples on real markets

- deadline-no-timezone:
  - (none found)
- occurrence-vs-reporting:
  - "ITF W35 Bistrita Women: Completed Match: Jessica Pieri vs Adrienn Nagy" (itf-pie-nag-2026-08-22-completed-match)
  - "ITF M15 Kursumlijska Banja 12 Men: Completed Match: Anton Arzhankin vs Kristijan Juhas" (itf-arzhank-juhas-2026-08-22-completed-match)
  - "ITF M15 Båstad Men: Completed Match: Leo Borg vs John Hallquist Lithen" (itf-borg-lithen-2026-08-22-completed-match)
- status-verb-gap:
  - (none found)
