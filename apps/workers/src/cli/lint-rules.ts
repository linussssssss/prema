import { createDb, databaseUrlFromEnv, loadEnv } from "@verdict/schema";
import { runLinterOverRules } from "../lint/run.ts";
import { logger } from "../lib/log.ts";

loadEnv();

// Standalone linter pass. Safe to run on its own and safe to re-run: versions
// that already have hits at this LINTER_VERSION are skipped, so an interrupted
// run resumes where it stopped. `dataset:build` calls the same function.
const handle = await createDb(databaseUrlFromEnv());
try {
  logger.info(await runLinterOverRules(handle.db), "linter finished");
} finally {
  await handle.close();
}
