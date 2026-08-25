import { createDb, databaseUrlFromEnv, loadEnv } from "@verdict/schema";
import { analyzeRulesDrift, formatDrift } from "./rules-drift.ts";

loadEnv();
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;

const handle = await createDb(databaseUrlFromEnv());
try {
  const stats = await analyzeRulesDrift(handle.db, limit);
  process.stdout.write(formatDrift(stats) + "\n");
} finally {
  await handle.close?.();
}
