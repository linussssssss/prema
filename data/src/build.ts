/**
 * `pnpm dataset:build` — rebuild the full labeled dataset from scratch.
 * Sequential, idempotent, resumable (ADR-0005). Steps that cannot run (e.g.
 * no RPC key) are recorded as skipped/failed and stated in REPORT.md — never
 * papered over.
 *
 * Env caps for demo/CI runs:
 *   DATASET_MAX_PAGES   max Gamma pages per pass (100 markets/page)
 *   DATASET_MAX_BLOCKS  max blocks per chain this run
 *   DATASET_SKIP_GAMMA  "1" to skip venue ingestion
 *   DATASET_SKIP_CHAIN  "1" to skip on-chain indexing
 *   DATASET_STORE_RAW   "1" to store full Gamma objects (jsonb)
 *   DATASET_NEWEST_FIRST      "1": crawl Gamma newest-first (capped demo runs)
 *   DATASET_CHAIN_FROM_RECENT "1": index head-maxBlocks..head (keyless demo)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, databaseUrlFromEnv, loadEnv } from "@verdict/schema";
import {
  computeLabels,
  indexEthereum,
  indexPolygon,
  ingestPolymarketMarkets,
  logger,
  runLinterOverRules,
} from "@verdict/workers";
import { exportAll } from "./exporters.ts";
import { generateReport, type BuildInfo, type BuildStep } from "./report.ts";

loadEnv();

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportsDir = path.join(dataDir, "exports");

const caps = {
  DATASET_MAX_PAGES: process.env.DATASET_MAX_PAGES,
  DATASET_MAX_BLOCKS: process.env.DATASET_MAX_BLOCKS,
  DATASET_SKIP_GAMMA: process.env.DATASET_SKIP_GAMMA,
  DATASET_SKIP_CHAIN: process.env.DATASET_SKIP_CHAIN,
  DATASET_STORE_RAW: process.env.DATASET_STORE_RAW,
};

const handle = await createDb(databaseUrlFromEnv());
const info: BuildInfo = { startedAt: new Date(), driver: handle.driver, steps: [], caps };
const step = (s: BuildStep) => {
  info.steps.push(s);
  logger.info({ step: s.name, status: s.status, detail: s.detail }, "build step finished");
};

try {
  await handle.migrate();
  step({ name: "migrate", status: "ok", detail: `schema up to date (${handle.driver})` });

  // 1) Venue ingestion (Gamma)
  if (caps.DATASET_SKIP_GAMMA === "1") {
    step({ name: "ingest-gamma", status: "skipped", detail: "DATASET_SKIP_GAMMA=1" });
  } else {
    try {
      const maxPages = caps.DATASET_MAX_PAGES ? Number(caps.DATASET_MAX_PAGES) : undefined;
      const stats = await ingestPolymarketMarkets(handle.db, {
        maxPages,
        storeRaw: caps.DATASET_STORE_RAW === "1",
        newestFirst: process.env.DATASET_NEWEST_FIRST === "1",
      });
      const capped = maxPages !== undefined;
      step({
        name: "ingest-gamma",
        status: capped ? "partial" : "ok",
        detail: `${stats.upserted} markets upserted, ${stats.newRulesVersions} rules versions, ${stats.pagesFetched} pages${capped ? ` (capped at ${maxPages}/pass)` : ""}, ${stats.skippedPre2024} pre-2024 skipped`,
      });
    } catch (err) {
      step({ name: "ingest-gamma", status: "failed", detail: String(err).slice(0, 300) });
    }
  }

  // 2) On-chain indexing
  if (caps.DATASET_SKIP_CHAIN === "1") {
    step({ name: "index-polygon", status: "skipped", detail: "DATASET_SKIP_CHAIN=1" });
    step({ name: "index-ethereum", status: "skipped", detail: "DATASET_SKIP_CHAIN=1" });
  } else {
    const maxBlocks = caps.DATASET_MAX_BLOCKS ? BigInt(caps.DATASET_MAX_BLOCKS) : undefined;
    try {
      const stats = await indexPolygon(handle.db, { maxBlocks });
      step({
        name: "index-polygon",
        status: stats.complete ? "ok" : "partial",
        detail: `blocks ${stats.fromBlock}–${stats.toBlock}, ${stats.eventsStored} events, managed oracle: ${stats.managedOracle ?? "not found"}${stats.complete ? "" : " (capped run — history NOT fully indexed)"}`,
      });
    } catch (err) {
      step({ name: "index-polygon", status: "failed", detail: String(err).slice(0, 300) });
    }
    try {
      const stats = await indexEthereum(handle.db, { maxBlocks });
      step({
        name: "index-ethereum",
        status: stats.complete ? "ok" : "partial",
        detail: `blocks ${stats.fromBlock}–${stats.toBlock}, ${stats.eventsStored} events, ${stats.votesStored} votes${stats.complete ? "" : " (capped run — history NOT fully indexed)"}`,
      });
    } catch (err) {
      step({ name: "index-ethereum", status: "failed", detail: String(err).slice(0, 300) });
    }
  }

  // 3) Linter over every rules version
  try {
    const stats = await runLinterOverRules(handle.db);
    step({
      name: "linter",
      status: "ok",
      detail: `${stats.versionsLinted} versions linted (+${stats.versionsSkipped} already done), ${stats.hitsStored} hits stored`,
    });
  } catch (err) {
    step({ name: "linter", status: "failed", detail: String(err).slice(0, 300) });
  }

  // 4) Composite labels
  try {
    const stats = await computeLabels(handle.db);
    step({
      name: "labels",
      status: "ok",
      detail: `${stats.marketsLabeled} markets labeled, ${stats.contestedMarkets} contested, ${stats.disputesUpserted} dispute records`,
    });
  } catch (err) {
    step({ name: "labels", status: "failed", detail: String(err).slice(0, 300) });
  }

  // 5) Exports + report
  mkdirSync(exportsDir, { recursive: true });
  const { files, summary } = await exportAll(handle.db, exportsDir);
  step({ name: "export", status: "ok", detail: files.map((f) => path.basename(f)).join(", ") });

  const report = await generateReport(handle.db, summary, info);
  const reportPath = path.join(dataDir, "REPORT.md");
  writeFileSync(reportPath, report, "utf8");
  logger.info({ reportPath, exports: files }, "dataset build complete");

  if (report.includes("**FAIL")) {
    logger.error("SANITY CHECK FAILED — see data/REPORT.md before trusting this dataset");
    process.exitCode = 1;
  }
} finally {
  await handle.close();
}
