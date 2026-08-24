import { createDb, databaseUrlFromEnv, loadEnv } from "@verdict/schema";
import { analyzeSignal, formatReport } from "./analyze-signal.ts";

loadEnv();
const handle = await createDb(databaseUrlFromEnv());
try {
  const report = await analyzeSignal(handle.db);
  console.log(report === null ? "No labels yet — run `dataset:build` first. (backfill → labels → this)" : formatReport(report));
} finally {
  await handle.close();
}
