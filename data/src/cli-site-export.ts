import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, databaseUrlFromEnv, loadEnv } from "@verdict/schema";
import { buildSiteExport } from "./site-export.ts";
import { logger } from "@verdict/workers";

loadEnv();
// Resolved from this file, not cwd: `pnpm --filter` runs the child inside data/.
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const handle = await createDb(databaseUrlFromEnv());
try {
  const stats = await buildSiteExport(handle.db, outDir);
  logger.info({ records: stats.disputeRecords, outDir, files: stats.files }, "site export written");
  for (const reason of stats.skipped) logger.warn({ reason }, "not emitted");
} finally {
  await handle.close();
}
