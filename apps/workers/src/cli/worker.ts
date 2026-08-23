/**
 * Long-running BullMQ worker for recurring jobs:
 *   - clob-snapshot: hourly order-book snapshot of top open markets
 *   - gamma-repoll-open: 6-hourly re-poll of open markets (rules-edit detection)
 * The one-shot dataset build does NOT go through the queue (ADR-0005).
 */
import { Queue, Worker } from "bullmq";
import { createDb, databaseUrlFromEnv, loadEnv } from "@verdict/schema";
import { snapshotTopMarkets } from "../clob/snapshot.ts";
import { ingestPolymarketMarkets } from "../gamma/ingest.ts";
import { logger } from "../lib/log.ts";

loadEnv();

const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };
const QUEUE = "verdict-jobs";

const queue = new Queue(QUEUE, { connection });
await queue.upsertJobScheduler("clob-snapshot", { every: 60 * 60 * 1000 }, { name: "clob-snapshot" });
await queue.upsertJobScheduler("gamma-repoll-open", { every: 6 * 60 * 60 * 1000 }, { name: "gamma-repoll-open" });

const handle = await createDb(databaseUrlFromEnv());

const worker = new Worker(
  QUEUE,
  async (job) => {
    logger.info({ job: job.name }, "job started");
    if (job.name === "clob-snapshot") return snapshotTopMarkets(handle.db, { topN: 200 });
    if (job.name === "gamma-repoll-open") return ingestPolymarketMarkets(handle.db, {});
    logger.warn({ job: job.name }, "unknown job");
    return null;
  },
  { connection, concurrency: 1 },
);

worker.on("completed", (job, result) => logger.info({ job: job.name, result }, "job completed"));
worker.on("failed", (job, err) => logger.error({ job: job?.name, err: err.message }, "job failed"));

logger.info({ queue: QUEUE }, "worker running");
