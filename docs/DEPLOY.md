# DEPLOY — running the backfill on a VPS

Written 2026-08-24 for a Hetzner CPX22 (2 vCPU / 4 GB / 80 GB NVMe, Ubuntu
24.04), after two thermal shutdowns killed local runs. Everything is `root` on
a short-lived box; adjust if you keep it.

**Before cloning, make sure you are on `ac59e94` or later.** That commit binds
every compose port to `127.0.0.1`. Before it, Postgres, MinIO and an
unauthenticated Redis published on `0.0.0.0` — fine behind a laptop NAT,
compromised within minutes on a public IP.

---

## 1. Base setup (on the server)

```bash
# swap first — 4 GB RAM with Postgres + Node is workable but tight
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

apt update && apt upgrade -y
apt install -y git tmux unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

curl -fsSL https://get.docker.com | sh          # includes the compose plugin
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
npm i -g pnpm@10.34.5                            # matches packageManager in package.json

node -v && pnpm -v && docker compose version     # sanity
```

## 2. Copy artifacts up (from the laptop)

```powershell
scp C:\Users\Linus\Desktop\prema\backups\*.dump root@<ip>:/root/
scp C:\Users\Linus\Desktop\prema\.env            root@<ip>:/root/
```

The `.env` must contain at least `DATABASE_URL`, `REDIS_URL` and
`POLYGON_RPC_URL` (the Infura key). See `.env.example`. Never commit it — the
repo `.gitignore` already covers `.env`.

## 3. Clone and configure

```bash
cd /root && git clone https://github.com/linussssssss/prema.git verdict-repo
cd verdict-repo && git log --oneline -1          # must be >= ac59e94
mv /root/.env .                                  # loadEnv() finds it here
pnpm install
```

If the repo is private, either use a PAT in the clone URL or add a deploy key
(`ssh-keygen -t ed25519` on the server, paste the `.pub` into GitHub → repo →
Settings → Deploy keys) and clone over SSH.

## 4. Start the stack and create the schema

```bash
docker compose up -d
ss -tlnp | grep -E '5432|6379|9000'   # EVERY line must show 127.0.0.1, never 0.0.0.0
pnpm db:migrate
```

If anything binds `0.0.0.0`, stop and `git pull` — you are on a pre-`ac59e94`
compose file.

## 5. Restore

Order does not matter: `--disable-triggers` turns off FK validation during the
load, which is needed because the staging split `venues` (dump 1) from
`markets` (dump 3). The data was consistent when dumped.

```bash
for f in 1-chain-state 2-rules-versions 3-markets; do
  docker cp /root/$f.dump verdict-postgres-1:/tmp/
  docker exec verdict-postgres-1 pg_restore -U verdict -d verdict \
    --data-only --disable-triggers /tmp/$f.dump
  docker exec verdict-postgres-1 rm -f /tmp/$f.dump
done
```

**Verify before going further:**

```bash
docker exec verdict-postgres-1 psql -U verdict -d verdict -c \
  "select (select count(*) from markets) markets,
          (select count(*) from rules_versions) rules,
          (select count(*) from resolution_events) events,
          (select value from ingest_state where key='chain:polygon:lastBlock') cursor;"
```

Expect **2615958 / 2615958 / 56833** and cursor `{"lastBlock": "64468999"}`.
If the counts differ, stop — do not build on a partial restore.

## 6. Regenerate what was deliberately not backed up

`linter_hits` (5.18M rows) and `rules_clauses` are deterministic from
`rules_versions`, so backing them up would have tripled the transfer for
nothing. Rebuild them:

```bash
pnpm --filter @verdict/workers run lint:rules    # ~1-2h on 2 vCPU
```

Expect 2,615,958 versions linted and ~5,183,533 hits. Safe to re-run: versions
already linted at this `LINTER_VERSION` are skipped.

## 7. Resume the backfill

**In tmux**, or an SSH drop kills the job — the exact failure you moved here to
escape.

```bash
tmux new -s backfill
pnpm --filter @verdict/workers run ingest:chain -- --chain polygon 2>&1 | tee /root/backfill.log
# detach: Ctrl-B then D      reattach: tmux attach -t backfill
```

**No `--reset-cursor` and no `--from-block`** — `ingest_state` came across in
dump 1, so it resumes from block 64,468,999 where the laptop died. Roughly 28M
blocks remain ≈ 2.1M Infura credits ≈ 5–7 hours, and Infura's free tier is
3M credits/day.

Watch for: `managed oracle resolved on-chain` with `0x2c0367a9…`, chunk spans
near 10,000 blocks, and `eventsStored` climbing. A 429 or a network blip is
handled — the sweep backs off in time rather than shrinking or dying.

Then:

```bash
DATASET_SKIP_GAMMA=1 pnpm dataset:build          # linter skips; labels + export
pnpm --filter @verdict/data run validate
```

The sanity gate should report **~2,000–2,600 disputes for Jan–May 2026**
against a ~1,000 threshold. Far below that is a code fault, not the world.

## 8. Retrieve results, then destroy

```bash
docker exec verdict-postgres-1 pg_dump -U verdict -d verdict -Fc \
  -T linter_hits -T rules_clauses -f /tmp/final.dump
docker cp verdict-postgres-1:/tmp/final.dump /root/final.dump
```

```powershell
scp root@<ip>:/root/final.dump          C:\Users\Linus\Desktop\prema\backups\
scp -r root@<ip>:/root/verdict-repo/data/exports C:\Users\Linus\Desktop\prema\backups\
scp root@<ip>:/root/verdict-repo/data/REPORT.md  C:\Users\Linus\Desktop\prema\backups\
```

Then delete the server in the console — billing is hourly, so a finished run
costs cents. Keep the dumps; they are the durable artifact.

**Do not delete it if you are going straight on to Phase 3**: the re-poll
worker must run continuously for weeks to give `rules_edited_after_listing` any
signal, and that is the one job a laptop structurally cannot do.
