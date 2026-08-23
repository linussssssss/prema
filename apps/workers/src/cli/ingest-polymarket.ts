import { parseArgs } from "node:util";
import { createDb, databaseUrlFromEnv, loadEnv } from "@verdict/schema";
import { ingestPolymarketMarkets } from "../gamma/ingest.ts";
import { logger } from "../lib/log.ts";

loadEnv();

const { values } = parseArgs({
  options: {
    "max-pages": { type: "string" },
    "store-raw": { type: "boolean", default: false },
  },
});

const handle = await createDb(databaseUrlFromEnv());
try {
  const stats = await ingestPolymarketMarkets(handle.db, {
    maxPages: values["max-pages"] ? Number(values["max-pages"]) : undefined,
    storeRaw: values["store-raw"] ?? false,
  });
  logger.info(stats, "gamma ingest finished");
} finally {
  await handle.close();
}
